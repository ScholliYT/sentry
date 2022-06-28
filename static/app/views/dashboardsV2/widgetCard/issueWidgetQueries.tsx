import {useRef, useState} from 'react';
import {useEffect} from '@storybook/addons';

import {Client} from 'sentry/api';
import MemberListStore from 'sentry/stores/memberListStore';
import {Group, Organization, PageFilters} from 'sentry/types';
import getDynamicText from 'sentry/utils/getDynamicText';

import {IssuesConfig} from '../datasetConfig/issues';
import {Widget} from '../types';

import GenericWidgetQueries, {
  GenericWidgetQueriesChildrenProps,
} from './genericWidgetQueries';

type Props = {
  api: Client;
  children: (props: GenericWidgetQueriesChildrenProps) => JSX.Element;
  organization: Organization;
  selection: PageFilters;
  widget: Widget;
  cursor?: string;
  limit?: number;
  onDataFetched?: (results: {pageLinks?: string; totalIssuesCount?: string}) => void;
};

function IssueWidgetQueries({
  children,
  api,
  organization,
  selection,
  widget,
  cursor,
  limit,
  onDataFetched,
}: Props) {
  const [memberListStoreLoaded, setMemberListStoreLoaded] = useState(false);

  const memberListStoreUnlistener = useRef(
    MemberListStore.listen(() => {
      setMemberListStoreLoaded(MemberListStore.isLoaded());
    }, undefined)
  );

  useEffect(() => {
    return memberListStoreUnlistener.current?.();
  }, []);

  const config = IssuesConfig;

  return getDynamicText({
    value: (
      <GenericWidgetQueries<never, Group[]>
        config={config}
        api={api}
        organization={organization}
        selection={selection}
        widget={widget}
        cursor={cursor}
        limit={limit}
        onDataFetched={onDataFetched}
      >
        {({loading, ...rest}) =>
          children({
            loading: loading && memberListStoreLoaded,
            ...rest,
          })
        }
      </GenericWidgetQueries>
    ),
    fixed: <div />,
  });
}

export default IssueWidgetQueries;
