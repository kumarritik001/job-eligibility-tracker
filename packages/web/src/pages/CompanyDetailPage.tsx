/**
 * Company detail: identity, stat breakdown, and the company's jobs with
 * eligibility tabs plus the filter/sort controls the server supports.
 *
 * Counts come from Company.activeJobs/eligibleJobs/... so they always agree
 * with the rest of the app.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { PageHeader, StatTile, FilterBar, Field } from '../components/Primitives';
import { AsyncBoundary, EmptyState, ErrorState } from '../components/StateViews';
import { JobCard } from '../components/JobCard';
import { ResearchPanel } from '../components/ResearchPanel';
import { useCompany, useResearch } from '../hooks/useData';
import { asEligibilityStatus, relativeTime } from '../lib/format';
import { EXPERIENCE_LABELS, POSTED_LABELS, experienceBucket, matchesPostedWindow, type ExperienceBucket } from '../lib/jobs';
import type { CompanyJob, PostedWindow, StatusFilter } from '../types/api';

const TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ELIGIBLE', label: 'Eligible' },
  { key: 'INELIGIBLE', label: 'Ineligible' },
  { key: 'UNCERTAIN', label: 'Uncertain' },
];

const SORTS = [
  { value: 'NEWEST', label: 'Newest' },
  { value: 'OLDEST', label: 'Oldest' },
  { value: 'DEADLINE_SOONEST', label: 'Deadline' },
  { value: 'ELIGIBILITY_FIRST', label: 'Eligibility' },
] as const;

type SortKey = (typeof SORTS)[number]['value'];

/** Deterministic ordering. Eligibility order matches the engine's precedence. */
function sortJobs(jobs: CompanyJob[], sort: SortKey): CompanyJob[] {
  const copy = [...jobs];
  const rank: Record<string, number> = { ELIGIBLE: 0, UNCERTAIN: 1, INELIGIBLE: 2 };
  const time = (v: string | null) => (v ? new Date(v).getTime() : 0);

  switch (sort) {
    case 'OLDEST':
      return copy.sort((a, b) => time(a.postedAt) - time(b.postedAt));
    case 'DEADLINE_SOONEST':
      return copy.sort((a, b) => (time(a.closingAt) || Infinity) - (time(b.closingAt) || Infinity));
    case 'ELIGIBILITY_FIRST':
      return copy.sort(
        (a, b) =>
          (rank[asEligibilityStatus(a.eligibilityStatus) ?? ''] ?? 3) -
            (rank[asEligibilityStatus(b.eligibilityStatus) ?? ''] ?? 3) || time(b.postedAt) - time(a.postedAt),
      );
    case 'NEWEST':
    default:
      return copy.sort((a, b) => time(b.postedAt) - time(a.postedAt));
  }
}

export function CompanyDetailPage(): JSX.Element {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, loading, error, refetch } = useCompany(companyId);
  const research = useResearch(companyId, refetch);

  const [tab, setTab] = useState<StatusFilter>('ALL');
  const [location, setLocation] = useState('');
  const [experience, setExperience] = useState<'' | ExperienceBucket>('');
  const [posted, setPosted] = useState<PostedWindow>('ANY');
  const [employmentType, setEmploymentType] = useState('');
  const [sort, setSort] = useState<SortKey>('NEWEST');

  const visible = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const needle = location.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      if (tab !== 'ALL' && asEligibilityStatus(job.eligibilityStatus) !== tab) return false;
      if (needle) {
        const haystack = [job.location, job.city, job.country].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (experience && experienceBucket(job) !== experience) return false;
      if (!matchesPostedWindow(job, posted)) return false;
      if (employmentType && job.employmentType !== employmentType) return false;
      return true;
    });
    return sortJobs(filtered, sort);
  }, [data, tab, location, experience, posted, employmentType, sort]);

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorState error={error} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={data?.company.name ?? 'Company'}
        description={data?.company.careersUrl ?? undefined}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            // Wrapped, not passed by reference: React would hand `start` the
            // click event as its first argument.
            onClick={() => void research.start()}
            disabled={research.busy || !companyId}
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${research.busy ? 'animate-spin' : ''}`} />
            {research.busy ? 'Researching…' : 'Research Now'}
          </button>
        }
      />

      {data?.company.careersUrl ? (
        <a
          href={data.company.careersUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-secondary mb-4"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          Open careers page
        </a>
      ) : null}

      {research.phase !== 'idle' ? (
        <div className="mb-4">
          <ResearchPanel phase={research.phase} steps={research.steps} run={research.run} onDismiss={research.reset} />
        </div>
      ) : null}

      <AsyncBoundary loading={loading} error={null} loadingRows={4}>
        {data ? (
          <>
            <p className="mb-4 text-xs text-muted">
              Last researched {relativeTime(data.company.lastResearchedAt) ?? 'never'}
              {data.company.atsProvider ? ` · source: ${data.company.atsProvider}` : ''}
            </p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="All active" value={data.company.activeJobs} />
              <StatTile label="Eligible" value={data.company.eligibleJobs} tone="eligible" />
              <StatTile label="Ineligible" value={data.company.ineligibleJobs} tone="ineligible" />
              <StatTile label="Uncertain" value={data.company.uncertainJobs} tone="uncertain" />
            </div>

            <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by eligibility">
              {TABS.map((t) => {
                const count =
                  t.key === 'ALL'
                    ? data.jobs.length
                    : data.jobs.filter((j) => asEligibilityStatus(j.eligibilityStatus) === t.key).length;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="tab"
                    aria-pressed={tab === t.key}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label} ({count})
                  </button>
                );
              })}
            </div>

            <FilterBar>
              <div className="min-w-40 flex-1">
                <Field label="Location">
                  <input
                    className="input"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City or country"
                  />
                </Field>
              </div>
              <Field label="Experience">
                <select className="input" value={experience} onChange={(e) => setExperience(e.target.value as '' | ExperienceBucket)}>
                  <option value="">Any</option>
                  {(Object.keys(EXPERIENCE_LABELS) as ExperienceBucket[]).map((key) => (
                    <option key={key} value={key}>
                      {EXPERIENCE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Posted">
                <select className="input" value={posted} onChange={(e) => setPosted(e.target.value as PostedWindow)}>
                  {(Object.keys(POSTED_LABELS) as PostedWindow[]).map((key) => (
                    <option key={key} value={key}>
                      {POSTED_LABELS[key]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employment type">
                <select className="input" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                  <option value="">Any</option>
                  {employmentTypes(data.jobs).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sort by">
                <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </FilterBar>

            {visible.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {visible.map((job) => (
                  <JobCard key={job.id} job={job} showCompany={false} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No jobs match these filters"
                description="Adjust or clear the filters to see this company's other openings."
                action={
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setTab('ALL');
                      setLocation('');
                      setExperience('');
                      setPosted('ANY');
                      setEmploymentType('');
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            )}
          </>
        ) : null}
      </AsyncBoundary>
    </>
  );
}

function employmentTypes(jobs: CompanyJob[]): string[] {
  return [...new Set(jobs.map((j) => j.employmentType).filter((t): t is string => Boolean(t)))].sort();
}

function BackLink(): JSX.Element {
  return (
    <Link to="/companies" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
      <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
      All companies
    </Link>
  );
}
