/**
 * Covers the required scenarios:
 *  1 dashboard rendering        8 job navigation
 *  2 company list              10 loading state
 *  3 company counts            11 error state
 *  4 eligible jobs            12 empty state
 *  5 ineligible jobs          13 authentication state
 *  6 uncertain jobs
 *  7 company navigation
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from '../App';
import { DashboardPage } from '../pages/DashboardPage';
import { CompaniesPage } from '../pages/CompaniesPage';
import { CompanyDetailPage } from '../pages/CompanyDetailPage';
import { JobDetailPage } from '../pages/JobDetailPage';
import { LoginPage } from '../pages/LoginPage';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import {
  companiesFixture,
  dashboardFixture,
  eligibleJob,
  ineligibleEligibility,
  ineligibleJob,
  makeCompanyJob,
  makeEligibility,
  uncertainEligibility,
} from '../test/fixtures';
import { installMockFetch, mockRoute, resetRoutes, signInFixture } from '../test/mockApi';

function renderApp(initialPath = '/dashboard'): void {
  // App no longer mounts a router, so the test supplies a MemoryRouter and can
  // start at any route.
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

/**
 * Renders a single page inside a real auth context, for focused assertions.
 *
 * `routePattern` must be supplied for detail pages: a literal path such as
 * `/companies/company-1` matches with no params, so useParams() would hand the
 * page an undefined id.
 */
function renderPage(
  ui: React.ReactNode,
  opts: { path?: string; routePattern?: string } = {},
): void {
  const { path = '/', routePattern } = opts;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern ?? path} element={<AuthProvider>{ui}</AuthProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCompanyDetail(): void {
  renderPage(<CompanyDetailPage />, {
    path: '/companies/company-1',
    routePattern: '/companies/:companyId',
  });
}

function renderJobDetail(path = '/jobs/job-1'): void {
  renderPage(<JobDetailPage />, { path, routePattern: '/jobs/:jobId' });
}

beforeEach(() => {
  resetRoutes();
  installMockFetch();
  // Default: authenticated, with the core reads stubbed.
  signInFixture();
  mockRoute('GET', '/api/auth/me', {
    status: 200,
    body: { userId: 'user-1', profile: null, profileGaps: [] },
  });
  mockRoute('GET', '/api/dashboard', { status: 200, body: dashboardFixture });
  mockRoute('GET', '/api/companies', { status: 200, body: companiesFixture });
  mockRoute('GET', '/api/notifications', {
    status: 200,
    body: { notifications: [], unread: 0 },
  });
});

// --- 1. Dashboard rendering -------------------------------------------------

describe('Dashboard', () => {
  it('renders the live summary counts from the backend', async () => {
    renderPage(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Companies tracked')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument(); // companiesTracked
    expect(screen.getByText('60')).toBeInTheDocument(); // activeJobs
    expect(screen.getByText('12')).toBeInTheDocument(); // eligibleJobs
    expect(screen.getByText('18')).toBeInTheDocument(); // uncertainJobs
  });

  it('shows an empty state instead of numbers when nothing is tracked', async () => {
    mockRoute('GET', '/api/dashboard', {
      status: 200,
      body: {
        ...dashboardFixture,
        summary: { ...dashboardFixture.summary, companiesTracked: 0, activeJobs: 0, eligibleJobs: 0, uncertainJobs: 0 },
        recentJobs: [],
        closingSoon: [],
        recentRuns: [],
      },
    });

    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Nothing tracked yet')).toBeInTheDocument());
    expect(screen.queryByText('Active jobs')).not.toBeInTheDocument();
  });

  it('surfaces profile gaps so the user can trust the verdicts', async () => {
    mockRoute('GET', '/api/dashboard', {
      status: 200,
      body: { ...dashboardFixture, profileGaps: ['Graduation year', 'Skills'] },
    });

    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Your profile is incomplete')).toBeInTheDocument());
    expect(screen.getByText('Graduation year')).toBeInTheDocument();
  });
});

// --- 2/3. Company list and counts ------------------------------------------

describe('Companies', () => {
  it('lists companies with the counts the server computed', async () => {
    renderPage(<CompaniesPage />);

    await waitFor(() => expect(screen.getByRole('link', { name: 'ExxonMobil' })).toBeInTheDocument());
    const row = screen.getByRole('link', { name: 'ExxonMobil' }).closest('tr') as HTMLElement;

    expect(within(row).getByText('42')).toBeInTheDocument(); // activeJobs
    expect(within(row).getByText('7')).toBeInTheDocument(); // eligibleJobs
    expect(within(row).getByText('15')).toBeInTheDocument(); // uncertainJobs
  });

  it('filters the list as the user searches', async () => {
    const user = userEvent.setup();
    renderPage(<CompaniesPage />);

    await waitFor(() => expect(screen.getByRole('link', { name: 'ExxonMobil' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search companies'), 'reliance');

    await waitFor(() => expect(screen.queryByRole('link', { name: 'ExxonMobil' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Reliance Industries' })).toBeInTheDocument();
  });

  it('confirms before removing a company', async () => {
    const user = userEvent.setup();
    let deleted = false;
    mockRoute('DELETE', '/api/companies/company-1', () => {
      deleted = true;
      return { ok: true };
    });

    renderPage(<CompaniesPage />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'ExxonMobil' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove ExxonMobil' }));
    expect(deleted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(deleted).toBe(true));
  });
});

// --- 7. Company navigation --------------------------------------------------

describe('Company navigation', () => {
  it('navigates from the list to the company detail page', async () => {
    const user = userEvent.setup();
    mockRoute('GET', '/api/companies/company-1', {
      status: 200,
      body: { company: companiesFixture.companies[0], jobs: [makeCompanyJob()], runs: [] },
    });

    renderApp('/companies');
    await waitFor(() => expect(screen.getByRole('link', { name: 'ExxonMobil' })).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'ExxonMobil' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ExxonMobil', level: 1 })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Process Engineer' })).toBeInTheDocument();
  });
});

// --- 4/5/6. Job eligibility rendering ---------------------------------------

describe('Job eligibility', () => {
  const companyBody = {
    company: companiesFixture.companies[0],
    runs: [],
    jobs: [
      makeCompanyJob({ id: 'e', title: 'Eligible Role', eligibilityStatus: 'ELIGIBLE', eligibility: makeEligibility() }),
      makeCompanyJob({ id: 'i', title: 'Ineligible Role', eligibilityStatus: 'INELIGIBLE', eligibility: ineligibleEligibility }),
      makeCompanyJob({ id: 'u', title: 'Uncertain Role', eligibilityStatus: 'UNCERTAIN', eligibility: uncertainEligibility }),
    ],
  };

  it('renders an ELIGIBLE job with stronger emphasis than the others', async () => {
    mockRoute('GET', '/api/companies/company-1', { status: 200, body: companyBody });
    renderCompanyDetail();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Eligible Role' })).toBeInTheDocument());
    const eligibleCard = screen.getByRole('link', { name: 'Eligible Role' }).closest('article') as HTMLElement;
    const ineligibleCard = screen.getByRole('link', { name: 'Ineligible Role' }).closest('article') as HTMLElement;

    // Status is conveyed by glyph + text, not colour alone.
    expect(within(eligibleCard).getByText('ELIGIBLE')).toBeInTheDocument();
    expect(within(eligibleCard).getByText('Recommended')).toBeInTheDocument();
    expect(eligibleCard.className).not.toBe(ineligibleCard.className);
  });

  it('renders an INELIGIBLE job with the reason the server gave', async () => {
    mockRoute('GET', '/api/companies/company-1', { status: 200, body: companyBody });
    renderCompanyDetail();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Ineligible Role' })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: /Ineligible \(1\)/ }));

    const card = screen.getByRole('link', { name: 'Ineligible Role' }).closest('article') as HTMLElement;
    expect(within(card).getByText('INELIGIBLE')).toBeInTheDocument();
    expect(within(card).getByText('✕')).toBeInTheDocument();
  });

  it('renders an UNCERTAIN job and marks the unknown requirement', async () => {
    mockRoute('GET', '/api/companies/company-1', { status: 200, body: companyBody });
    renderCompanyDetail();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Uncertain Role' })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: /Uncertain \(1\)/ }));

    const card = screen.getByRole('link', { name: 'Uncertain Role' }).closest('article') as HTMLElement;
    expect(within(card).getByText('UNCERTAIN')).toBeInTheDocument();
  });

  it('groups met / not-met / unknown checks on the detail page from the API', async () => {
    mockRoute('GET', '/api/jobs/job-ineligible', {
      status: 200,
      body: {
        job: ineligibleJob,
        requirements: null,
        eligibility: ineligibleEligibility,
        sources: [{ url: 'https://x', name: 'Example', official: true, firstSeenAt: '', lastSeenAt: '' }],
      },
    });

    renderJobDetail('/jobs/job-ineligible');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Senior Process Safety Lead' })).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Requirements met' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requirements not met' })).toBeInTheDocument();
    expect(screen.getByText('3+ years required')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open Original Job Posting/ }).getAttribute('href'),
    ).toBe(ineligibleJob.sourceUrl);
  });
});

// --- 8. Job navigation ------------------------------------------------------

describe('Job navigation', () => {
  it('opens a job from the company page and returns to the list', async () => {
    const user = userEvent.setup();
    mockRoute('GET', '/api/companies/company-1', {
      status: 200,
      body: { company: companiesFixture.companies[0], jobs: [makeCompanyJob()], runs: [] },
    });
    mockRoute('GET', '/api/jobs/job-1', {
      status: 200,
      body: { job: eligibleJob, requirements: null, eligibility: makeEligibility(), sources: [] },
    });

    renderApp('/companies/company-1');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Process Engineer' })).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'Process Engineer' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Process Engineer', level: 1 })).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: /All jobs/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Eligible jobs' })).toBeInTheDocument());
  });
});

// --- 10/11/12. Loading, error and empty states ------------------------------

describe('Async states', () => {
  it('shows a loading state before data arrives', async () => {
    // Starts as a no-op so the type stays callable; the executor replaces it.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockRoute('GET', '/api/dashboard', async () => {
      await gate;
      return dashboardFixture;
    });

    renderPage(<DashboardPage />);

    // The session restores first; only then does the dashboard request start,
    // so wait for the pending request rather than asserting on the first paint.
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
    const skeleton = screen
      .getAllByRole('status')
      .find((element) => element.getAttribute('aria-busy') === 'true');
    expect(skeleton).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.getByText('Companies tracked')).toBeInTheDocument());
  });

  it('shows an actionable error state when the server fails', async () => {
    mockRoute('GET', '/api/dashboard', { status: 500, body: { error: 'Something went wrong on the server. Please try again.' } });

    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('distinguishes a network failure from a server error', async () => {
    // /api/auth/me still succeeds, so the page is reached; only the data call
    // fails at the network level.
    mockRoute('GET', '/api/dashboard', { status: 0, body: null, networkError: true });

    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('No connection')).toBeInTheDocument());
    expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it('shows the empty state when the company list is empty', async () => {
    mockRoute('GET', '/api/companies', { status: 200, body: { companies: [] } });

    renderPage(<CompaniesPage />);
    await waitFor(() => expect(screen.getByText('No companies tracked yet')).toBeInTheDocument());
  });
});

// --- 13. Authentication -----------------------------------------------------

describe('Authentication', () => {
  function StatusProbe(): JSX.Element {
    const { status } = useAuth();
    return <span data-testid="auth-status">{status}</span>;
  }

  it('treats a 401 from any request as a signed-out session', async () => {
    mockRoute('GET', '/api/dashboard', { status: 401, body: { error: 'Sign in to continue.' } });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <StatusProbe />
          <Routes>
            <Route path="/" element={<DashboardPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
  });

  it('sends an unauthenticated visitor to the login page and back again', async () => {
    // No token: the guard must redirect.
    const { setTokenOverride } = await import('../api/client');
    setTokenOverride(null);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }

    mockRoute('POST', '/api/auth/login', {
      status: 200,
      body: { token: 'test.jwt.token', user: { id: 'user-1', email: 'ritik@example.com' } },
    });

    const user = userEvent.setup();
    renderApp('/dashboard');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Job Eligibility Tracker' })).toBeInTheDocument());
    expect(screen.getByLabelText('Email')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'ritik@example.com');
    await user.type(screen.getByLabelText('Password'), 'supersecret1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Companies tracked')).toBeInTheDocument());
  });

  it('sends an already-authenticated visitor away from the login form', async () => {
    // beforeEach signs in, so GET /api/auth/me succeeds and LoginPage's guard
    // should forward to the dashboard instead of showing the form.
    renderApp('/login');
    await waitFor(() => expect(screen.getByText('Companies tracked')).toBeInTheDocument());
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('shows the server message when login fails', async () => {
    // A genuinely anonymous session, so the form actually renders.
    const { setTokenOverride } = await import('../api/client');
    setTokenOverride(null);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    mockRoute('POST', '/api/auth/login', { status: 401, body: { error: 'Incorrect email or password.' } });

    const user = userEvent.setup();
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'wrong@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.'));
  });
});
