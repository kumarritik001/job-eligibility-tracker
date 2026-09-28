/**
 * Dashboard. Every number comes from GET /api/dashboard; nothing is derived
 * client-side and nothing is hardcoded.
 */

import { Link } from 'react-router-dom';
import { Building2, Sparkles, AlertTriangle } from 'lucide-react';
import { PageHeader, Section, StatTile } from '../components/Primitives';
import { AsyncBoundary, EmptyState } from '../components/StateViews';
import { JobCard } from '../components/JobCard';
import { useDashboard } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { daysUntil, formatDate, relativeTime } from '../lib/format';

export function DashboardPage(): JSX.Element {
  const { status } = useAuth();
  const { data, loading, error, refetch } = useDashboard(status === 'authenticated');

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your tracked companies and the openings you qualify for."
        actions={
          <Link to="/companies" className="btn btn-primary">
            <Building2 aria-hidden className="h-4 w-4" />
            Manage companies
          </Link>
        }
      />

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingRows={4}
        empty={
          <EmptyState
            title="Nothing tracked yet"
            description="Add your first company to start researching openings and seeing which ones you are eligible for."
            action={
              <Link to="/companies" className="btn btn-primary">
                Add a company
              </Link>
            }
          />
        }
      >
        {data ? <DashboardBody data={data} /> : null}
      </AsyncBoundary>
    </>
  );
}

function DashboardBody({ data }: { data: NonNullable<ReturnType<typeof useDashboard>['data']> }): JSX.Element {
  const { summary, profileGaps, recentJobs, closingSoon, recentRuns, capabilities } = data;
  const nothingTracked = summary.companiesTracked === 0;

  if (nothingTracked) {
    return (
      <EmptyState
        title="Nothing tracked yet"
        description="Add your first company to start researching openings and seeing which ones you are eligible for."
        action={
          <Link to="/companies" className="btn btn-primary">
            Add a company
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Companies tracked" value={summary.companiesTracked} />
        <StatTile label="Active jobs" value={summary.activeJobs} />
        <StatTile label="Eligible jobs" value={summary.eligibleJobs} tone="eligible" />
        <StatTile label="Uncertain jobs" value={summary.uncertainJobs} tone="uncertain" />
      </div>

      {profileGaps.length ? (
        <div className="card mt-4 border-uncertain/30 bg-uncertain-soft p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-uncertain" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-uncertain">Your profile is incomplete</h2>
              <p className="mt-1 text-sm text-ink-2">
                Verdicts are only as good as your profile. Add the missing details and re-analyse.
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {profileGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
              <Link to="/profile" className="btn btn-secondary mt-3">
                Complete profile
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <Section
        title="Recently eligible"
        description="The newest openings the engine marked eligible for you."
        actions={
          <Link to="/jobs?status=ELIGIBLE" className="btn btn-secondary">
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            View all eligible
          </Link>
        }
      >
        {recentJobs.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {recentJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No eligible jobs yet"
            description="Once research finds openings you qualify for, they will appear here."
          />
        )}
      </Section>

      {closingSoon.length ? (
        <Section title="Closing soon" description="Openings whose deadline is within a week.">
          <ul className="card divide-y divide-line">
            {closingSoon.map((job) => {
              const left = daysUntil(job.closingAt);
              return (
                <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/jobs/${job.id}`} className="truncate text-sm font-medium hover:text-brand">
                      {job.title}
                    </Link>
                    <p className="truncate text-xs text-muted">{job.companyName}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      left !== null && left <= 3 ? 'text-ineligible' : 'text-muted'
                    }`}
                  >
                    {left !== null && left >= 0 ? `${left}d left` : formatDate(job.closingAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {recentRuns.length ? (
        <Section title="Research activity" description="The most recent research runs across your companies.">
          <ul className="card divide-y divide-line">
            {recentRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      run.status === 'COMPLETED'
                        ? 'bg-eligible'
                        : run.status === 'FAILED'
                          ? 'bg-ineligible'
                          : 'bg-uncertain'
                    }`}
                    aria-hidden
                  />
                  {run.status.toLowerCase()}
                </span>
                <span className="text-xs text-muted">
                  {run.jobsFound} found · {run.jobsNew} new · {relativeTime(run.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!capabilities.searchProvider ? (
        <p className="mt-6 text-xs text-muted">
          No search provider is configured on this server, so discovering new companies may be limited. You can
          still add companies by name.
        </p>
      ) : null}
    </>
  );
}
