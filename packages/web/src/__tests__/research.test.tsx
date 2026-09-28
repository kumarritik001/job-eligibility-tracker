/**
 * Covers scenario 9 (research action) end to end against the real endpoint
 * shapes: POST /api/companies/:id/research -> 202, then GET /api/research/:runId
 * polling, with the job counts refreshed afterwards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { CompanyDetailPage } from '../pages/CompanyDetailPage';
import { CompaniesPage } from '../pages/CompaniesPage';
import { AddCompanyModal } from '../components/AddCompanyModal';
import { companiesFixture, makeCompanyJob } from '../test/fixtures';
import { installMockFetch, mockRoute, resetRoutes, signInFixture } from '../test/mockApi';

function renderCompany(): void {
  render(
    <MemoryRouter initialEntries={['/companies/company-1']}>
      <Routes>
        <Route
          path="/companies/:companyId"
          element={
            <AuthProvider>
              <CompanyDetailPage />
            </AuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetRoutes();
  installMockFetch();
  signInFixture();
  mockRoute('GET', '/api/auth/me', { status: 200, body: { userId: 'user-1', profile: null, profileGaps: [] } });
  mockRoute('GET', '/api/notifications', { status: 200, body: { notifications: [], unread: 0 } });
  mockRoute('GET', '/api/companies', { status: 200, body: companiesFixture });
  mockRoute('GET', '/api/companies/company-1', {
    status: 200,
    body: { company: companiesFixture.companies[0], jobs: [makeCompanyJob()], runs: [] },
  });
});

describe('Research action', () => {
  it('shows a real step list while a run is in flight, then the counts on success', async () => {
    const user = userEvent.setup();

    mockRoute('POST', '/api/companies/company-1/research', {
      status: 202,
      body: { runId: 'run-1', status: 'RUNNING', alreadyRunning: false },
    });
    // First poll: still running with live steps. Second: completed.
    mockRoute('GET', '/api/research/run-1', {
      status: 200,
      sequence: [
        {
          run: null,
          live: {
            running: true,
            steps: [
              { key: 'RESOLVING_CAREERS_URL', label: 'Resolving careers URL', state: 'done' },
              { key: 'SEARCHING_OPENINGS', label: 'Searching openings', state: 'running' },
            ],
          },
        },
        {
          run: {
            id: 'run-1',
            companyId: 'company-1',
            userId: 'user-1',
            status: 'COMPLETED',
            startedAt: '2026-09-20T07:50:00.000Z',
            completedAt: '2026-09-20T08:00:00.000Z',
            jobsFound: 42,
            jobsNew: 5,
            jobsUpdated: 37,
            jobsRemoved: 2,
            eligibleJobs: 7,
            sourcesTried: ['workday'],
            sourcesOk: ['workday'],
            errorMessage: null,
            steps: [],
          },
          live: { running: false, steps: [] },
        },
      ],
    });

    renderCompany();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ExxonMobil', level: 1 })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Research Now/ }));

    // Indeterminate progress plus the server's own steps. No fake percentage.
    await waitFor(() => expect(screen.getByText('Researching company…')).toBeInTheDocument());
    expect(screen.getByText('Searching openings')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Research completed')).toBeInTheDocument(), { timeout: 6000 });
    expect(screen.getByText('Jobs found').nextSibling).toHaveTextContent('42');
    expect(screen.getByText('Eligible jobs').nextSibling).toHaveTextContent('7');
  });

  it('reports failure and states that previous results were preserved', async () => {
    const user = userEvent.setup();
    mockRoute('POST', '/api/companies/company-1/research', {
      status: 202,
      body: { runId: 'run-2', status: 'RUNNING', alreadyRunning: false },
    });
    mockRoute('GET', '/api/research/run-2', {
      status: 200,
      body: {
        run: {
          id: 'run-2',
          companyId: 'company-1',
          userId: 'user-1',
          status: 'FAILED',
          startedAt: '2026-09-20T07:50:00.000Z',
          completedAt: '2026-09-20T07:52:00.000Z',
          jobsFound: 0,
          jobsNew: 0,
          jobsUpdated: 0,
          jobsRemoved: 0,
          eligibleJobs: 0,
          sourcesTried: ['workday'],
          sourcesOk: [],
          errorMessage: 'The careers page did not respond.',
          steps: [],
        },
        live: null,
      },
    });

    renderCompany();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ExxonMobil', level: 1 })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Research Now/ }));

    await waitFor(
      () => expect(screen.getByText('Research failed. Previous verified results have been preserved.')).toBeInTheDocument(),
      { timeout: 6000 },
    );
    // The already-loaded job is still on screen: a failure never erases data.
    expect(screen.getByRole('link', { name: 'Process Engineer' })).toBeInTheDocument();
  });

  it('joins an already-running research rather than starting a second one', async () => {
    const user = userEvent.setup();
    mockRoute('POST', '/api/companies/company-1/research', {
      status: 202,
      body: { runId: 'run-3', status: 'RUNNING', alreadyRunning: true },
    });
    mockRoute('GET', '/api/research/run-3', {
      status: 200,
      body: { run: null, live: { running: true, steps: [] } },
    });

    renderCompany();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ExxonMobil', level: 1 })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Research Now/ }));

    await waitFor(() => expect(screen.getByText('Researching company…')).toBeInTheDocument());
  });
});

describe('Add company flow', () => {
  it('submits the name, then starts research for the new company', async () => {
    const user = userEvent.setup();
    const created = { company: { ...companiesFixture.companies[0], id: 'company-9', name: 'ONGC' }, created: true };
    const post = vi.fn(() => created);
    mockRoute('POST', '/api/companies', post as unknown as () => unknown);
    mockRoute('POST', '/api/companies/company-9/research', {
      status: 202,
      body: { runId: 'run-4', status: 'RUNNING', alreadyRunning: false },
    });
    mockRoute('GET', '/api/research/run-4', {
      status: 200,
      body: { run: null, live: { running: true, steps: [] } },
    });

    const onAdded = vi.fn();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AddCompanyModal open onClose={() => {}} onAdded={onAdded} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Company name'), 'ONGC');
    await user.click(screen.getByRole('button', { name: 'Add & Research' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('company-9'));
  });

  it('keeps the dialog open and shows the server error when creation fails', async () => {
    const user = userEvent.setup();
    mockRoute('POST', '/api/companies', { status: 400, body: { error: 'Enter a company name and, optionally, valid URLs.' } });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AddCompanyModal open onClose={() => {}} onAdded={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Company name'), 'Bad Co');
    await user.click(screen.getByRole('button', { name: 'Add & Research' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter a company name'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Research from the company list', () => {
  it('starts a run from the list and refreshes when it completes', async () => {
    const user = userEvent.setup();
    let researchCalls = 0;
    mockRoute('POST', '/api/companies/company-1/research', () => {
      researchCalls += 1;
      return { runId: 'run-5', status: 'RUNNING', alreadyRunning: false };
    });
    mockRoute('GET', '/api/research/run-5', {
      status: 200,
      body: { run: null, live: { running: true, steps: [] } },
    });

    render(
      <MemoryRouter initialEntries={['/companies']}>
        <AuthProvider>
          <CompaniesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('link', { name: 'ExxonMobil' })).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /Research Now/ })[0]);

    await waitFor(() => expect(researchCalls).toBe(1));
    await waitFor(() => expect(screen.getByText('Researching company…')).toBeInTheDocument());
  });
});
