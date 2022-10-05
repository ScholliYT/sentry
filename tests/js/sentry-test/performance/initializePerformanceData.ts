import {initializeOrg} from 'sentry-test/initializeOrg';
import {RawSpanType} from 'sentry/components/events/interfaces/spans/types';

import {
  EntryType,
  EventOrGroupType,
  EventTransaction,
  PerformanceDetectorData,
  Project,
} from 'sentry/types';
import {defined} from 'sentry/utils';
import EventView from 'sentry/utils/discover/eventView';
import {
  ExampleSpan,
  ExampleTransaction,
  SuspectSpan,
} from 'sentry/utils/performance/suspectSpans/types';

export interface initializeDataSettings {
  features?: string[];
  project?: any; // TODO(k-fish): Fix this project type.
  projects?: Project[];
  query?: {};
  selectedProject?: number | string;
}

export function initializeData(settings?: initializeDataSettings) {
  const _defaultProject = TestStubs.Project();
  const _settings = {
    query: {},
    features: [],
    projects: [_defaultProject],
    project: _defaultProject,
    ...settings,
  };
  const {query, features, projects, selectedProject: project} = _settings;

  const organization = TestStubs.Organization({
    features,
    projects,
  });
  const routerLocation: {query: {project?: number}} = {
    query: {
      ...query,
    },
  };
  if (settings?.selectedProject || settings?.project) {
    routerLocation.query.project = (project || settings?.project) as any;
  }
  const router = {
    location: routerLocation,
  };
  const initialData = initializeOrg({organization, projects, project, router});
  const location = initialData.router.location;
  const eventView = EventView.fromLocation(location);

  return {...initialData, location, eventView};
}

export const SAMPLE_SPANS = [
  {
    op: 'op1',
    group: 'aaaaaaaaaaaaaaaa',
    description: 'span-1',
    examples: [
      {
        id: 'abababababababab',
        description: 'span-1',
        spans: [{id: 'ababab11'}, {id: 'ababab22'}],
      },
      {
        id: 'acacacacacacacac',
        description: 'span-2',
        spans: [{id: 'acacac11'}, {id: 'acacac22'}],
      },
      {
        id: 'adadadadadadadad',
        description: 'span-3',
        spans: [{id: 'adadad11'}, {id: 'adadad22'}],
      },
    ],
  },
  {
    op: 'op2',
    group: 'bbbbbbbbbbbbbbbb',
    description: 'span-4',
    examples: [
      {
        id: 'bcbcbcbcbcbcbcbc',
        description: 'span-4',
        spans: [{id: 'bcbcbc11'}, {id: 'bcbcbc11'}],
      },
      {
        id: 'bdbdbdbdbdbdbdbd',
        description: 'span-5',
        spans: [{id: 'bdbdbd11'}, {id: 'bdbdbd22'}],
      },
      {
        id: 'bebebebebebebebe',
        description: 'span-6',
        spans: [{id: 'bebebe11'}, {id: 'bebebe22'}],
      },
    ],
  },
];

type SpanOpt = {
  id: string;
};

type ExampleOpt = {
  description: string;
  id: string;
  spans: SpanOpt[];
};

type SuspectOpt = {
  description: string;
  examples: ExampleOpt[];
  group: string;
  op: string;
};

function makeSpan(opt: SpanOpt): ExampleSpan {
  const {id} = opt;
  return {
    id,
    startTimestamp: 10100,
    finishTimestamp: 10200,
    exclusiveTime: 100,
  };
}

function makeExample(opt: ExampleOpt): ExampleTransaction {
  const {id, description, spans} = opt;
  return {
    id,
    description,
    startTimestamp: 10000,
    finishTimestamp: 12000,
    nonOverlappingExclusiveTime: 2000,
    spans: spans.map(makeSpan),
  };
}

export function makeSuspectSpan(opt: SuspectOpt): SuspectSpan {
  const {op, group, description, examples} = opt;
  return {
    op,
    group,
    description,
    frequency: 1,
    count: 1,
    avgOccurrences: 1,
    sumExclusiveTime: 5,
    p50ExclusiveTime: 1,
    p75ExclusiveTime: 2,
    p95ExclusiveTime: 3,
    p99ExclusiveTime: 4,
    examples: examples.map(makeExample),
  };
}

export function generateSuspectSpansResponse(opts?: {
  examples?: number;
  examplesOnly?: boolean;
}) {
  const {examples, examplesOnly} = opts ?? {};
  return SAMPLE_SPANS.map(sampleSpan => {
    const span = {...sampleSpan};
    if (defined(examples)) {
      span.examples = span.examples.slice(0, examples);
    }
    const suspectSpans = makeSuspectSpan(span);
    if (examplesOnly) {
      return {
        op: suspectSpans.op,
        group: suspectSpans.group,
        examples: suspectSpans.examples,
      };
    }
    return suspectSpans;
  });
}

export function generateSampleEvent(
  perfProblem?: PerformanceDetectorData
): EventTransaction {
  const event = {
    id: '2b658a829a21496b87fd1f14a61abf65',
    eventID: '2b658a829a21496b87fd1f14a61abf65',
    title: '/organizations/:orgId/discover/results/',
    type: 'transaction',
    startTimestamp: 1622079935.86141,
    endTimestamp: 1622079940.032905,
    contexts: {
      trace: {
        trace_id: '8cbbc19c0f54447ab702f00263262726',
        span_id: 'a000000000000000',
        op: 'pageload',
        status: 'unknown',
        type: 'trace',
      },
    },
    entries: [
      {
        data: [],
        type: EntryType.SPANS,
      },
    ],
  } as EventTransaction;

  return event;
}

export function generateSampleSpan(
  description: string | null,
  op: string | null,
  span_id: string,
  parent_span_id: string,
  event: EventTransaction
) {
  const span = {
    start_timestamp: 1000,
    timestamp: 2000,
    description,
    op,
    span_id,
    parent_span_id,
    trace_id: '8cbbc19c0f54447ab702f00263262726',
    status: 'ok',
    tags: {
      'http.status_code': '200',
    },
    data: {},
  };

  event.entries[0].data.push(span);
  return span;
}

class TransactionEventBuilder {
  TRACE_ID = '8cbbc19c0f54447ab702f00263262726';
  _event: EventTransaction;
  _spanCount = 0;

  constructor() {
    this._event = {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      title: '/api/0/transaction-test-endpoint/',
      type: EventOrGroupType.TRANSACTION,
      startTimestamp: 0,
      endTimestamp: 0,
      contexts: {
        trace: {
          trace_id: this.TRACE_ID,
          span_id: '0000000000000000',
          op: 'pageload',
          status: 'ok',
          type: 'trace',
        },
      },
      entries: [
        {
          data: [],
          type: EntryType.SPANS,
        },
      ],
      // For the purpose of mock data, we don't care as much about the properties below.
      // They're here to satisfy the type constraints, but in the future if we need actual values here
      // for testing purposes, we can add methods on the builder to set them.
      crashFile: null,
      culprit: '',
      dateReceived: '',
      dist: null,
      errors: [],
      fingerprints: [],
      location: null,
      message: '',
      metadata: {
        current_level: undefined,
        current_tree_label: undefined,
        directive: undefined,
        display_title_with_tree_label: undefined,
        filename: undefined,
        finest_tree_label: undefined,
        function: undefined,
        message: undefined,
        origin: undefined,
        stripped_crash: undefined,
        title: undefined,
        type: undefined,
        uri: undefined,
        value: undefined,
      },
      projectID: '',
      size: 0,
      tags: [],
      user: null,
    };
  }

  addSpan(
    start: number,
    end: number,
    op?: string,
    description?: string,
    status?: string,
    numSpans?: number
  ) {
    // Increment the span count and convert it to a hex string to get its ID
    const spanId = (this._spanCount++).toString(16).padStart(16, '0');
    console.log(spanId);

    const span: RawSpanType = {
      op,
      description,
      start_timestamp: start,
      timestamp: end,
      status: status ?? 'ok',
      data: {},
      span_id: spanId,
      trace_id: this.TRACE_ID,
    };

    this._event.entries[0].data.push(span);
  }
}
