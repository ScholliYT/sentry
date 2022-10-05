import time
from datetime import datetime, timedelta
from random import Random

from django.template.defaultfilters import slugify
from django.utils import timezone

from sentry.incidents.models import (
    AlertRule,
    AlertRuleTrigger,
    Incident,
    IncidentStatus,
    TriggerStatus,
)
from sentry.models import Organization, Project, User
from sentry.tasks.weekly_reports import (
    OrganizationReportContext,
    ProjectContext,
    render_template_context,
)
from sentry.utils import loremipsum
from sentry.utils.dates import floor_to_utc_day, to_datetime, to_timestamp

from .mail import MailPreviewView


def get_random(request):
    seed = request.GET.get("seed", str(time.time()))
    return Random(seed)


class DebugWeeklyReportView(MailPreviewView):
    def get_context(self, request):
        organization = Organization(id=1, slug="myorg", name="MyOrg")

        random = get_random(request)

        duration = 60 * 60 * 24 * 7
        timestamp = to_timestamp(
            floor_to_utc_day(
                to_datetime(
                    random.randint(
                        to_timestamp(datetime(2015, 6, 1, 0, 0, 0, tzinfo=timezone.utc)),
                        to_timestamp(datetime(2016, 7, 1, 0, 0, 0, tzinfo=timezone.utc)),
                    )
                )
            )
        )
        ctx = OrganizationReportContext(timestamp, duration, organization)
        ctx.projects.clear()

        # Initialize projects
        for i in range(0, random.randint(1, 8)):
            name = " ".join(random.sample(loremipsum.words, random.randint(1, 4)))
            project = Project(
                id=i,
                organization=organization,
                slug=slugify(name),
                name=name,
                date_added=ctx.start - timedelta(days=random.randint(0, 120)),
            )
            project_context = ProjectContext(project)
            project_context.dropped_transaction_count = int(
                random.weibullvariate(5, 1) * random.paretovariate(0.2)
            )
            project_context.accepted_transaction_count = int(
                random.weibullvariate(5, 1) * random.paretovariate(0.2)
            )
            project_context.dropped_error_count = int(
                random.weibullvariate(5, 1) * random.paretovariate(0.2)
            )
            project_context.accepted_error_count = int(
                random.weibullvariate(5, 1) * random.paretovariate(0.2)
            )
            ctx.projects[project.id] = project_context

        return render_template_context(ctx, request.user)

    @property
    def html_template(self):
        return "sentry/emails/reports/new.html"

    @property
    def text_template(self):
        return "sentry/emails/reports/new.txt"
