import {initializeOrg} from 'sentry-test/initializeOrg';
import {render, screen, userEvent, waitFor} from 'sentry-test/reactTestingLibrary';

import * as useApi from 'sentry/utils/useApi';
import {OrganizationContext} from 'sentry/views/organizationContext';
import {RouteContext} from 'sentry/views/routeContext';

import {SpanEvidencePreview} from './spanEvidencePreview';

describe('SpanEvidencePreview', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  const {organization, router} = initializeOrg();

  const TestComponent: typeof SpanEvidencePreview = props => (
    <OrganizationContext.Provider value={organization}>
      <RouteContext.Provider
        value={{router, location: router.location, params: {}, routes: []}}
      >
        <SpanEvidencePreview {...props} />
      </RouteContext.Provider>
    </OrganizationContext.Provider>
  );

  it('does not fetch before hover', () => {
    const api = new MockApiClient();
    jest.spyOn(useApi, 'default').mockReturnValue(api);
    const spy = jest.spyOn(api, 'requestPromise');

    render(
      <TestComponent eventId="event-id" projectSlug="project-slug" groupId="group-id">
        Hover me
      </TestComponent>
    );

    jest.runAllTimers();

    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches from event URL when event and project are provided', async () => {
    const mock = MockApiClient.addMockResponse({
      url: `/projects/org-slug/project-slug/events/event-id/`,
      body: null,
    });

    render(
      <TestComponent eventId="event-id" projectSlug="project-slug" groupId="group-id">
        Hover me
      </TestComponent>
    );

    userEvent.hover(screen.getByText('Hover me'));

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
  });

  it('fetches from group URL when only group ID is provided', async () => {
    const mock = MockApiClient.addMockResponse({
      url: `/issues/group-id/events/latest/`,
      body: null,
    });

    render(<TestComponent groupId="group-id">Hover me</TestComponent>);

    userEvent.hover(screen.getByText('Hover me'));

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
  });

  it('shows error when request fails', async () => {
    const api = new MockApiClient();
    jest.spyOn(useApi, 'default').mockReturnValue(api);
    jest.spyOn(api, 'requestPromise').mockRejectedValue(new Error());

    render(<TestComponent groupId="group-id">Hover me</TestComponent>);

    userEvent.hover(screen.getByText('Hover me'));

    await screen.findByText('Failed to load preview');
  });
});
