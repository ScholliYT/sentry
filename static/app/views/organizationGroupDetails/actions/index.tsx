import {Component, Fragment, MouseEvent} from 'react';
import {browserHistory} from 'react-router';
import styled from '@emotion/styled';
import {Query} from 'history';

import {bulkDelete, bulkUpdate} from 'sentry/actionCreators/group';
import {addLoadingMessage, clearIndicators} from 'sentry/actionCreators/indicator';
import {
  ModalRenderProps,
  openModal,
  openReprocessEventModal,
} from 'sentry/actionCreators/modal';
import {Client} from 'sentry/api';
import Access from 'sentry/components/acl/access';
import Feature from 'sentry/components/acl/feature';
import FeatureDisabled from 'sentry/components/acl/featureDisabled';
import ActionButton from 'sentry/components/actions/button';
import IgnoreActions from 'sentry/components/actions/ignore';
import ResolveActions from 'sentry/components/actions/resolve';
import GuideAnchor from 'sentry/components/assistant/guideAnchor';
import Button from 'sentry/components/button';
import DropdownMenuControl from 'sentry/components/dropdownMenuControl';
import {IconEllipsis} from 'sentry/icons';
import {t} from 'sentry/locale';
import GroupStore from 'sentry/stores/groupStore';
import space from 'sentry/styles/space';
import {
  Group,
  GroupStatusResolution,
  Organization,
  Project,
  ResolutionStatus,
  SavedQueryVersions,
} from 'sentry/types';
import {Event} from 'sentry/types/event';
import {analytics} from 'sentry/utils/analytics';
import trackAdvancedAnalyticsEvent from 'sentry/utils/analytics/trackAdvancedAnalyticsEvent';
import {getUtcDateString} from 'sentry/utils/dates';
import EventView from 'sentry/utils/discover/eventView';
import {displayReprocessEventAction} from 'sentry/utils/displayReprocessEventAction';
import {getIssueCapability} from 'sentry/utils/groupCapabilities';
import {uniqueId} from 'sentry/utils/guid';
import withApi from 'sentry/utils/withApi';
import withOrganization from 'sentry/utils/withOrganization';
import ReviewAction from 'sentry/views/issueList/actions/reviewAction';
import ShareIssue from 'sentry/views/organizationGroupDetails/actions/shareIssue';

import SubscribeAction from './subscribeAction';

type Props = {
  api: Client;
  disabled: boolean;
  group: Group;
  organization: Organization;
  project: Project;
  event?: Event;
  query?: Query;
};

class Actions extends Component<Props> {
  getShareUrl(shareId: string) {
    if (!shareId) {
      return '';
    }

    const path = `/share/issue/${shareId}/`;
    const {host, protocol} = window.location;
    return `${protocol}//${host}${path}`;
  }

  getDiscoverUrl() {
    const {group, project, organization} = this.props;
    const {title, type, shortId} = group;

    const discoverQuery = {
      id: undefined,
      name: title || type,
      fields: ['title', 'release', 'environment', 'user.display', 'timestamp'],
      orderby: '-timestamp',
      query: `issue:${shortId}`,
      projects: [Number(project.id)],
      version: 2 as SavedQueryVersions,
      range: '90d',
    };

    const discoverView = EventView.fromSavedQuery(discoverQuery);
    return discoverView.getResultsViewUrlTarget(organization.slug);
  }

  trackIssueAction(
    action:
      | 'shared'
      | 'deleted'
      | 'bookmarked'
      | 'subscribed'
      | 'mark_reviewed'
      | 'discarded'
      | 'open_in_discover'
      | ResolutionStatus
  ) {
    const {group, project, organization, query = {}} = this.props;
    const {alert_date, alert_rule_id, alert_type} = query;
    trackAdvancedAnalyticsEvent('issue_details.action_clicked', {
      organization,
      project_id: parseInt(project.id, 10),
      group_id: parseInt(group.id, 10),
      issue_category: group.issueCategory,
      action_type: action,
      // Alert properties track if the user came from email/slack alerts
      alert_date:
        typeof alert_date === 'string' ? getUtcDateString(Number(alert_date)) : undefined,
      alert_rule_id: typeof alert_rule_id === 'string' ? alert_rule_id : undefined,
      alert_type: typeof alert_type === 'string' ? alert_type : undefined,
    });
  }

  onDelete = () => {
    const {group, project, organization, api} = this.props;

    addLoadingMessage(t('Delete event\u2026'));

    bulkDelete(
      api,
      {
        orgId: organization.slug,
        projectId: project.slug,
        itemIds: [group.id],
      },
      {
        complete: () => {
          clearIndicators();

          browserHistory.push(`/${organization.slug}/${project.slug}/`);
        },
      }
    );

    this.trackIssueAction('deleted');
  };

  onUpdate = (
    data:
      | {isBookmarked: boolean}
      | {isSubscribed: boolean}
      | {inbox: boolean}
      | GroupStatusResolution
  ) => {
    const {group, project, organization, api} = this.props;

    addLoadingMessage(t('Saving changes\u2026'));

    bulkUpdate(
      api,
      {
        orgId: organization.slug,
        projectId: project.slug,
        itemIds: [group.id],
        data,
      },
      {
        complete: clearIndicators,
      }
    );

    if ((data as GroupStatusResolution).status) {
      this.trackIssueAction((data as GroupStatusResolution).status);
    }
    if ((data as {inbox: boolean}).inbox !== undefined) {
      this.trackIssueAction('mark_reviewed');
    }
  };

  onReprocessEvent = () => {
    const {group, organization} = this.props;
    openReprocessEventModal({organization, groupId: group.id});
  };

  onToggleShare = () => {
    const newIsPublic = !this.props.group.isPublic;
    if (newIsPublic) {
      trackAdvancedAnalyticsEvent('issue.shared_publicly', {
        organization: this.props.organization,
      });
    }
    this.trackIssueAction('shared');
  };

  onToggleBookmark = () => {
    this.onUpdate({isBookmarked: !this.props.group.isBookmarked});
    this.trackIssueAction('bookmarked');
  };

  onToggleSubscribe = () => {
    this.onUpdate({isSubscribed: !this.props.group.isSubscribed});
    this.trackIssueAction('subscribed');
  };

  onDiscard = () => {
    const {group, project, organization, api} = this.props;
    const id = uniqueId();
    addLoadingMessage(t('Discarding event\u2026'));

    GroupStore.onDiscard(id, group.id);

    api.request(`/issues/${group.id}/`, {
      method: 'PUT',
      data: {discard: true},
      success: response => {
        GroupStore.onDiscardSuccess(id, group.id, response);
        browserHistory.push(`/${organization.slug}/${project.slug}/`);
      },
      error: error => {
        GroupStore.onDiscardError(id, group.id, error);
      },
      complete: clearIndicators,
    });
    this.trackIssueAction('discarded');
  };

  renderDiscardModal = ({Body, Footer, closeModal}: ModalRenderProps) => {
    const {organization, project} = this.props;

    function renderDiscardDisabled({children, ...props}) {
      return children({
        ...props,
        renderDisabled: ({features}: {features: string[]}) => (
          <FeatureDisabled
            alert
            featureName={t('Discard and Delete')}
            features={features}
          />
        ),
      });
    }

    return (
      <Feature
        features={['projects:discard-groups']}
        hookName="feature-disabled:discard-groups"
        organization={organization}
        project={project}
        renderDisabled={renderDiscardDisabled}
      >
        {({hasFeature, renderDisabled, ...props}) => (
          <Fragment>
            <Body>
              {!hasFeature &&
                typeof renderDisabled === 'function' &&
                renderDisabled({...props, hasFeature, children: null})}
              {t(
                `Discarding this event will result in the deletion of most data associated with this issue and future events being discarded before reaching your stream. Are you sure you wish to continue?`
              )}
            </Body>
            <Footer>
              <Button onClick={closeModal}>{t('Cancel')}</Button>
              <Button
                style={{marginLeft: space(1)}}
                priority="primary"
                onClick={this.onDiscard}
                disabled={!hasFeature}
              >
                {t('Discard Future Events')}
              </Button>
            </Footer>
          </Fragment>
        )}
      </Feature>
    );
  };

  openDeleteModal = () =>
    openModal(({Body, Footer, closeModal}: ModalRenderProps) => (
      <Fragment>
        <Body>
          {t('Deleting this issue is permanent. Are you sure you wish to continue?')}
        </Body>
        <Footer>
          <Button onClick={closeModal}>{t('Cancel')}</Button>
          <Button
            style={{marginLeft: space(1)}}
            priority="primary"
            onClick={this.onDelete}
          >
            {t('Delete')}
          </Button>
        </Footer>
      </Fragment>
    ));

  openDiscardModal = () => {
    const {organization} = this.props;

    openModal(this.renderDiscardModal);
    analytics('feature.discard_group.modal_opened', {
      org_id: parseInt(organization.id, 10),
    });
  };

  handleClick(disabled: boolean, onClick: (event?: MouseEvent) => void) {
    return function (event: MouseEvent) {
      if (disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      onClick(event);
    };
  }

  render() {
    const {group, project, organization, disabled, event} = this.props;
    const {status, isBookmarked} = group;

    const orgFeatures = new Set(organization.features);

    const bookmarkKey = isBookmarked ? 'unbookmark' : 'bookmark';
    const bookmarkTitle = isBookmarked ? t('Remove bookmark') : t('Bookmark');
    const hasRelease = !!project.features?.includes('releases');

    const isResolved = status === 'resolved';
    const isIgnored = status === 'ignored';

    const deleteCap = getIssueCapability(group.issueCategory, 'delete');
    const deleteDiscardCap = getIssueCapability(group.issueCategory, 'deleteAndDiscard');
    const shareCap = getIssueCapability(group.issueCategory, 'share');

    return (
      <Wrapper>
        <GuideAnchor target="resolve" position="bottom" offset={20}>
          <ResolveActions
            disabled={disabled}
            disableDropdown={disabled}
            hasRelease={hasRelease}
            latestRelease={project.latestRelease}
            onUpdate={this.onUpdate}
            orgSlug={organization.slug}
            projectSlug={project.slug}
            isResolved={isResolved}
            isAutoResolved={
              group.status === 'resolved' ? group.statusDetails.autoResolved : undefined
            }
          />
        </GuideAnchor>
        <GuideAnchor target="ignore_delete_discard" position="bottom" offset={20}>
          <IgnoreActions
            isIgnored={isIgnored}
            onUpdate={this.onUpdate}
            disabled={disabled}
          />
        </GuideAnchor>
        <ReviewAction
          onUpdate={this.onUpdate}
          disabled={!group.inbox || disabled}
          tooltip={t('Issue has been reviewed')}
          tooltipProps={{disabled: !!group.inbox || disabled, delay: 300}}
        />
        <Feature
          hookName="feature-disabled:open-in-discover"
          features={['discover-basic']}
          organization={organization}
        >
          <ActionButton
            disabled={disabled}
            to={disabled ? '' : this.getDiscoverUrl()}
            onClick={() => this.trackIssueAction('open_in_discover')}
          >
            <GuideAnchor target="open_in_discover">{t('Open in Discover')}</GuideAnchor>
          </ActionButton>
        </Feature>
        {orgFeatures.has('shared-issues') && (
          <ShareIssue
            organization={organization}
            group={group}
            disabled={disabled || !shareCap.enabled}
            disabledReason={shareCap.disabledReason}
            onToggle={this.onToggleShare}
          />
        )}
        <SubscribeAction
          disabled={disabled}
          group={group}
          onClick={this.handleClick(disabled, this.onToggleSubscribe)}
        />
        <Access organization={organization} access={['event:admin']}>
          {({hasAccess}) => (
            <DropdownMenuControl
              triggerProps={{
                'aria-label': t('More Actions'),
                icon: <IconEllipsis size="xs" />,
                showChevron: false,
                size: 'xs',
              }}
              items={[
                {
                  key: bookmarkKey,
                  label: bookmarkTitle,
                  hidden: false,
                  onAction: this.onToggleBookmark,
                },
                {
                  key: 'reprocess',
                  label: t('Reprocess events'),
                  hidden: !displayReprocessEventAction(organization.features, event),
                  onAction: this.onReprocessEvent,
                },
                {
                  key: 'delete-issue',
                  priority: 'danger',
                  label: t('Delete'),
                  hidden: !hasAccess,
                  disabled: !deleteCap.enabled,
                  details: deleteCap.disabledReason,
                  onAction: this.openDeleteModal,
                },
                {
                  key: 'delete-and-discard',
                  priority: 'danger',
                  label: t('Delete and discard future events'),
                  hidden: !hasAccess,
                  disabled: !deleteDiscardCap.enabled,
                  details: deleteDiscardCap.disabledReason,
                  onAction: this.openDiscardModal,
                },
              ]}
            />
          )}
        </Access>
      </Wrapper>
    );
  }
}

const Wrapper = styled('div')`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  grid-auto-flow: column;
  gap: ${space(0.5)};
  white-space: nowrap;
`;

export {Actions};

export default withApi(withOrganization(Actions));
