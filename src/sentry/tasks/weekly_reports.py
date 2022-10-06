import bisect
import logging
import math
import operator
import zlib
from collections import OrderedDict, namedtuple
from datetime import date, datetime, timedelta
from functools import partial, reduce
from itertools import zip_longest
from typing import Iterable, Mapping, NamedTuple, Tuple

import pytz
import sentry_sdk
from django.db.models import F
from django.utils import dateformat, timezone
from sentry_sdk import set_tag, set_user
from snuba_sdk import Request
from snuba_sdk.column import Column
from snuba_sdk.conditions import Condition, Op
from snuba_sdk.entity import Entity
from snuba_sdk.expressions import Granularity
from snuba_sdk.function import Function
from snuba_sdk.orderby import Direction, OrderBy
from snuba_sdk.query import Limit, Query

from sentry import features, tsdb
from sentry.api.serializers.snuba import zerofill
from sentry.cache import default_cache
from sentry.constants import DataCategory
from sentry.models import (
    Activity,
    Group,
    GroupHistory,
    GroupHistoryStatus,
    GroupStatus,
    Organization,
    OrganizationMember,
    OrganizationStatus,
    Project,
    Team,
    User,
    UserOption,
)
from sentry.snuba.dataset import Dataset
from sentry.tasks.base import instrumented_task
from sentry.types.activity import ActivityType
from sentry.utils import json, redis
from sentry.utils.dates import floor_to_utc_day, to_datetime, to_timestamp
from sentry.utils.email import MessageBuilder
from sentry.utils.iterators import chunked
from sentry.utils.math import mean
from sentry.utils.outcomes import Outcome
from sentry.utils.query import RangeQuerySetWrapper
from sentry.utils.snuba import parse_snuba_datetime, raw_snql_query

ONE_DAY = int(timedelta(days=1).total_seconds())
date_format = partial(dateformat.format, format_string="F jS, Y")


class OrganizationReportContext:
    def __init__(self, timestamp, duration, organization):
        self.timestamp = timestamp
        self.duration = duration

        self.start = to_datetime(timestamp - duration)
        self.end = to_datetime(timestamp)

        self.organization = organization
        self.projects = {}
        for project in organization.project_set.all():
            self.projects[project.id] = ProjectContext(project)

    def __repr__(self):
        return self.projects.__repr__()


class ProjectContext:
    accepted_error_count = 0
    dropped_error_count = 0
    accepted_transaction_count = 0
    dropped_transaction_count = 0

    def __init__(self, project):
        self.project = project

        # Array of (group_id, count)
        self.key_errors = []
        # Array of (transaction_name, count_this_week, p95_this_week, count_last_week, p95_last_week)
        self.key_transactions = []

        # Dictionary of { timestamp: count }
        self.error_count_by_day = {}
        # Dictionary of { timestamp: count }
        self.transaction_count_by_day = {}

    def __repr__(self):
        return f"{self.key_errors}, Errors: [Accepted {self.accepted_error_count}, Dropped {self.dropped_error_count}]\nTransactions: [Accepted {self.accepted_transaction_count} Dropped {self.dropped_transaction_count}]"


# The entry point. This task is scheduled to run every week.
@instrumented_task(
    name="sentry.tasks.weekly_reports.schedule_organizations",
    queue="reports.prepare",
    max_retries=5,
    acks_late=True,
)
def schedule_organizations(dry_run=False, timestamp=None, duration=None):
    if timestamp is None:
        # The time that the report was generated
        timestamp = to_timestamp(floor_to_utc_day(timezone.now()))

    if duration is None:
        # The total timespan that the task covers
        duration = ONE_DAY * 7

    organizations = Organization.objects.filter(status=OrganizationStatus.ACTIVE)
    for i, organization in enumerate(
        RangeQuerySetWrapper(organizations, step=10000, result_value_getter=lambda item: item.id)
    ):
        # if not features.has("organizations:weekly-email-refresh", organization):
        #    continue
        # Create a celery task per organization
        prepare_organization_report.delay(timestamp, duration, organization.id, dry_run=dry_run)


# This task is launched per-organization.
@instrumented_task(
    name="sentry.tasks.weekly_reports.prepare_organization_report",
    queue="reports.prepare",
    max_retries=5,
    acks_late=True,
)
def prepare_organization_report(timestamp, duration, organization_id, dry_run=False):
    organization = Organization.objects.get(id=organization_id)
    ctx = OrganizationReportContext(timestamp, duration, organization)

    # Run organization passes
    project_event_counts_for_organization(ctx)

    # Run project passes
    for project in organization.project_set.all():
        project_key_errors(ctx, project)
        project_key_transactions(ctx, project)

    # TODO: Run user passes

    # Finally, deliver the reports
    deliver_reports(ctx, dry_run=dry_run)


# Organization Passes
def project_event_counts_for_organization(ctx):
    def zerofill_data(data):
        return zerofill(data, ctx.start, ctx.end, ONE_DAY, fill_default=0)

    query = Query(
        match=Entity("outcomes"),
        select=[
            Column("outcome"),
            Column("category"),
            Function("sum", [Column("quantity")], "total"),
        ],
        where=[
            Condition(Column("timestamp"), Op.GTE, ctx.start),
            Condition(Column("timestamp"), Op.LT, ctx.end),
            Condition(Column("project_id"), Op.EQ, 1),
            Condition(Column("org_id"), Op.EQ, ctx.organization.id),
            Condition(
                Column("outcome"), Op.IN, [Outcome.ACCEPTED, Outcome.FILTERED, Outcome.RATE_LIMITED]
            ),
            Condition(
                Column("category"),
                Op.IN,
                [*DataCategory.error_categories(), DataCategory.TRANSACTION],
            ),
        ],
        groupby=[Column("outcome"), Column("category"), Column("project_id"), Column("time")],
        granularity=Granularity(ONE_DAY),
        orderby=[OrderBy(Column("time"), Direction.ASC)],
    )
    request = Request(dataset=Dataset.Outcomes.value, app_id="reports", query=query)
    data = raw_snql_query(request, referrer="reports.outcomes")["data"]

    for dat in data:
        project_id = dat["project_id"]
        project_ctx = ctx.projects[project_id]
        total = dat["total"]
        timestamp = int(to_timestamp(parse_snuba_datetime(dat["time"])))
        if dat["category"] == DataCategory.TRANSACTION:
            # Transaction outcome
            if dat["outcome"] == Outcome.RATE_LIMITED:
                project_ctx.dropped_transaction_count += total
            else:
                project_ctx.accepted_transaction_count += total
                project_ctx.transaction_count_by_day[timestamp] = total
        else:
            # Error outcome
            if dat["outcome"] == Outcome.RATE_LIMITED:
                project_ctx.dropped_error_count += total
            else:
                project_ctx.accepted_error_count += total
                project_ctx.error_count_by_day[timestamp] = (
                    project_ctx.error_count_by_day.get(timestamp, 0) + total
                )


# Project passes
def project_key_errors(ctx, project):
    # Take the 3 most frequently occuring events
    query = Query(
        match=Entity("events"),
        select=[Column("group_id"), Function("count", [])],
        where=[
            Condition(Column("timestamp"), Op.GTE, ctx.start),
            Condition(Column("timestamp"), Op.LT, ctx.end),
            Condition(Column("project_id"), Op.EQ, project.id),
        ],
        groupby=[Column("group_id")],
        orderby=[OrderBy(Function("count", []), Direction.DESC)],
        limit=Limit(3),
    )
    request = Request(dataset=Dataset.Events.value, app_id="reports", query=query)
    query_result = raw_snql_query(request, referrer="reports.key_errors")
    key_errors = query_result["data"]
    ctx.projects[project.id].key_errors = [(e["group_id"], e["count()"]) for e in key_errors]


def project_key_transactions(ctx, project):
    # Take the 3 most frequently occuring transactions this week
    query = Query(
        match=Entity("transactions"),
        select=[
            Column("transaction_name"),
            Function("quantile(0.95)", [Column("duration")], "p95"),
            Function("count", [], "count"),
        ],
        where=[
            Condition(Column("finish_ts"), Op.GTE, ctx.start),
            Condition(Column("finish_ts"), Op.LT, ctx.end),
            Condition(Column("project_id"), Op.EQ, project.id),
        ],
        groupby=[Column("transaction_name")],
        orderby=[OrderBy(Function("count", []), Direction.DESC)],
        limit=Limit(3),
    )
    request = Request(dataset=Dataset.Transactions.value, app_id="reports", query=query)
    query_result = raw_snql_query(request, referrer="weekly_reports.key_transactions.this_week")
    key_transactions = query_result["data"]
    ctx.projects[project.id].key_transactions_this_week = [
        (i["transaction_name"], i["count"], i["p95"]) for i in key_transactions
    ]

    # Query the p95 for those transactions last week
    query = Query(
        match=Entity("transactions"),
        select=[
            Column("transaction_name"),
            Function("quantile(0.95)", [Column("duration")], "p95"),
            Function("count", [], "count"),
        ],
        where=[
            Condition(Column("finish_ts"), Op.GTE, ctx.start - timedelta(days=7)),
            Condition(Column("finish_ts"), Op.LT, ctx.end - timedelta(days=7)),
            Condition(Column("project_id"), Op.EQ, project.id),
            Condition(
                Column("transaction_name"), Op.IN, [i["transaction_name"] for i in key_transactions]
            ),
        ],
        groupby=[Column("transaction_name")],
    )
    request = Request(dataset=Dataset.Transactions.value, app_id="reports", query=query)
    query_result = raw_snql_query(request, referrer="weekly_reports.key_transactions.last_week")

    # Join this week with last week
    last_week_data = {i["transaction_name"]: (i["count"], i["p95"]) for i in query_result["data"]}

    ctx.projects[project.id].key_transactions = [
        (i["transaction_name"], i["count"], i["p95"])
        + last_week_data.get(i["transaction_name"], (0, 0))
        for i in key_transactions
    ]


# Deliver reports
# For all users in the organization, we generate the template context for the user, and send the email.
def user_subscribed_to_organization_reports(user, organization):
    return organization.id not in (
        UserOption.objects.get_value(user, key="reports:disabled-organizations")
        or []  # A small number of users have incorrect data stored
    )


def deliver_reports(ctx, dry_run=False):
    member_set = ctx.organization.member_set.filter(
        user_id__isnull=False, user__is_active=True
    ).exclude(flags=F("flags").bitor(OrganizationMember.flags["member-limit:restricted"]))

    for member in member_set:
        user = member.user
        if not user_subscribed_to_organization_reports(user, ctx.organization):
            return
        send_email(ctx, user, dry_run=dry_run)


project_breakdown_colors = ["#422C6E", "#895289", "#D6567F", "#F38150", "#F2B713"]
total_color = """
linear-gradient(
    -45deg,
    #ccc 25%,
    transparent 25%,
    transparent 50%,
    #ccc 50%,
    #ccc 75%,
    transparent 75%,
    transparent
);
"""
other_color = "#f2f0fa"


# Serialize ctx for template, and calculate view parameters (like graph bar heights)
# This function should be pure, and it should not make any external queries
def render_template_context(ctx, user):
    # Render the first section of the email where we had the table showing the
    # number of accepted/dropped errors/transactions for each project.
    def trends():
        # Given an iterator of event counts, sum up their accepted/dropped errors/transaction counts.
        def sum_event_counts(project_ctxs):
            return reduce(
                lambda a, b: (a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]),
                [
                    (
                        project_ctx.accepted_error_count,
                        project_ctx.dropped_error_count,
                        project_ctx.accepted_transaction_count,
                        project_ctx.dropped_transaction_count,
                    )
                    for project_ctx in project_ctxs
                ],
                (0, 0, 0, 0),
            )

        projects_associated_with_user = list(filter(lambda project: True, ctx.projects.values()))
        # Highest volume projects go first
        projects_associated_with_user.sort(
            reverse=True,
            key=lambda item: item.accepted_error_count * item.accepted_transaction_count,
        )
        # Calculate total
        (
            total_error,
            total_dropped_error,
            total_transaction,
            total_dropped_transaction,
        ) = sum_event_counts(projects_associated_with_user)
        # The number of reports to keep is the same as the number of colors
        # available to use in the legend.
        projects_taken = projects_associated_with_user[: len(project_breakdown_colors)]
        # All other items are merged to "Others"
        projects_not_taken = projects_associated_with_user[len(project_breakdown_colors) :]

        # Calculate legend
        legend = [
            {
                "slug": project_ctx.project.slug,
                "url": project_ctx.project.get_absolute_url(),
                "color": project_breakdown_colors[i],
                "dropped_error_count": project_ctx.dropped_error_count,
                "accepted_error_count": project_ctx.accepted_error_count,
                "dropped_transaction_count": project_ctx.dropped_transaction_count,
                "accepted_transaction_count": project_ctx.accepted_transaction_count,
            }
            for i, project_ctx in enumerate(projects_taken)
        ]

        if len(projects_not_taken) > 0:
            (
                others_error,
                others_dropped_error,
                others_transaction,
                others_dropped_transaction,
            ) = sum_event_counts(projects_not_taken)
            legend.append(
                {
                    "slug": f"Other ({len(projects_not_taken)})",
                    "color": other_color,
                    "dropped_error_count": others_dropped_error,
                    "accepted_error_count": others_error,
                    "dropped_transaction_count": others_dropped_transaction,
                    "accepted_transaction_count": others_transaction,
                }
            )
        if len(projects_taken) > 1:
            legend.append(
                {
                    "slug": f"Total ({len(projects_associated_with_user)})",
                    "color": total_color,
                    "dropped_error_count": total_dropped_error,
                    "accepted_error_count": total_error,
                    "dropped_transaction_count": total_dropped_transaction,
                    "accepted_transaction_count": total_transaction,
                }
            )

        # Calculate series
        series = []
        for i in range(0, 7):
            t = int(to_timestamp(ctx.start)) + ONE_DAY * i
            project_series = [
                {
                    "color": project_breakdown_colors[i],
                    "error_count": project_ctx.error_count_by_day.get(t, 0),
                    "transaction_count": project_ctx.transaction_count_by_day.get(t, 0),
                }
                for i, project_ctx in enumerate(projects_taken)
            ]
            if len(projects_not_taken) > 0:
                project_series.append(
                    {
                        "color": other_color,
                        "error_count": sum(
                            map(
                                lambda project_ctx: project_ctx.error_count_by_day.get(t, 0),
                                projects_not_taken,
                            )
                        ),
                        "transaction_count": sum(
                            map(
                                lambda project_ctx: project_ctx.transaction_count_by_day.get(t, 0),
                                projects_not_taken,
                            )
                        ),
                    }
                )
            series.append((to_datetime(t), project_series))
        return {
            "legend": legend,
            "series": series,
            "total_error_count": total_error,
            "total_transaction_count": total_transaction,
            "error_maximum": max(  # The max error count on any single day
                sum(value["error_count"] for value in values) for timestamp, values in series
            ),
            "transaction_maximum": max(  # The max transaction count on any single day
                sum(value["transaction_count"] for value in values) for timestamp, values in series
            )
            if len(projects_taken) > 0
            else 0,
        }

    return {
        "organization": ctx.organization,
        "start": date_format(ctx.start),
        "end": date_format(ctx.end),
        "trends": trends(),
    }


def send_email(ctx, user, dry_run=False):
    template_ctx = render_template_context(ctx, user)

    message = MessageBuilder(
        subject=f"Weekly Report for {ctx.organization.name}: {date_format(ctx.start)} - {date_format(ctx.end)}",
        template="sentry/emails/reports/new.txt",
        html_template="sentry/emails/reports/new.html",
        type="report.organization",
        context=template_ctx,
        headers={"X-SMTPAPI": json.dumps({"category": "organization_weekly_report"})},
    )
    message.add_users((user.id,))
    if not dry_run:
        message.send()
