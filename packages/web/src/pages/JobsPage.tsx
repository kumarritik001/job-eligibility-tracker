/**
 * Job list. Filtering and sorting are sent to GET /api/jobs so the server
 * decides what matches; the page only reflects the response.
 */

import { useSearchParams } from 'react-router-dom';
import { PageHeader, FilterBar, Field } from '../components/Primitives';
import { AsyncBoundary, EmptyState } from '../components/StateViews';
import { JobCard } from '../components/JobCard';
import { useAuth } from '../hooks/useAuth';
import { useJobs } from '../hooks/useData';
import { POSTED_LABELS } from '../lib/jobs';
import type { JobSort, PostedWindow, StatusFilter } from '../types/api';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ELIGIBLE', label: 'Eligible' },
  { key: 'UNCERTAIN', label: 'Uncertain' },
  { key: 'INELIGIBLE', label: 'Ineligible' },
  { key: 'ALL', label: 'All' },
];

const SORT_OPTIONS: Array<{ value: JobSort; label: string }> = [
  { value: 'ELIGIBILITY_FIRST', label: 'Eligibility' },
  { value: 'NEWEST', label: 'Newest' },
  { value: 'OLDEST', label: 'Oldest' },
  { value: 'DEADLINE_SOONEST', label: 'Deadline' },
];

export function JobsPage(): JSX.Element {
  const { status } = useAuth();
  const [params, setParams] = useSearchParams();

  const statusFilter = (params.get('status') as StatusFilter | null) ?? 'ELIGIBLE';
  const sort = (params.get('sort') as JobSort | null) ?? 'ELIGIBILITY_FIRST';
  const location = params.get('location') ?? '';
  const experience = params.get('experience') ?? '';
  const employmentType = params.get('employmentType') ?? '';
  const posted = (params.get('posted') as PostedWindow | null) ?? 'ANY';
  const search = params.get('search') ?? '';

  const enabled = status === 'authenticated';
  const { data, loading, error, refetch } = useJobs(
    {
      status: statusFilter,
      sort,
      location: location || undefined,
      experience: (experience || undefined) as 'ENTRY' | 'MID' | 'SENIOR' | undefined,
      employmentType: employmentType || undefined,
      posted,
      search: search || undefined,
      limit: 50,
    },
    enabled,
  );

  // Filters live in the URL so a view can be linked and the back button works.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={statusFilter === 'ELIGIBLE' ? 'Eligible jobs' : 'All jobs'}
        description={
          data ? `${data.total} matching ${data.total === 1 ? 'opening' : 'openings'}` : 'Loading results…'
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by eligibility">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="tab"
            aria-pressed={statusFilter === t.key}
            onClick={() => setParam('status', t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar>
        <div className="min-w-44 flex-1">
          <Field label="Search">
            <input
              className="input"
              value={search}
              onChange={(e) => setParam('search', e.target.value)}
              placeholder="Title, keyword or company"
            />
          </Field>
        </div>
        <Field label="Location">
          <input
            className="input"
            value={location}
            onChange={(e) => setParam('location', e.target.value)}
            placeholder="Any"
          />
        </Field>
        <Field label="Experience">
          <select className="input" value={experience} onChange={(e) => setParam('experience', e.target.value)}>
            <option value="">Any</option>
            <option value="ENTRY">Entry (0–1 yr)</option>
            <option value="MID">Mid (2–4 yrs)</option>
            <option value="SENIOR">Senior (5+ yrs)</option>
          </select>
        </Field>
        <Field label="Employment type">
          <select
            className="input"
            value={employmentType}
            onChange={(e) => setParam('employmentType', e.target.value)}
          >
            <option value="">Any</option>
            {(data?.facets.employmentTypes ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Posted">
          <select className="input" value={posted} onChange={(e) => setParam('posted', e.target.value)}>
            {(Object.keys(POSTED_LABELS) as PostedWindow[]).map((k) => (
              <option key={k} value={k}>
                {POSTED_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort by">
          <select className="input" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingRows={5}
        isEmpty={!loading && !error && (data?.items.length ?? 0) === 0}
        empty={
          <EmptyState
            title={statusFilter === 'ELIGIBLE' ? 'No eligible jobs found' : 'No jobs match these filters'}
            description={
              statusFilter === 'ELIGIBLE'
                ? 'Nothing matches your profile right now. Try All jobs, or complete your profile so the engine can be more precise.'
                : 'Try relaxing a filter, or research a company to pull in more openings.'
            }
            action={
              <button type="button" className="btn btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </button>
            }
          />
        }
      >
        {data?.items.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.items.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              Showing {data.items.length} of {data.total}.
            </p>
          </>
        ) : null}
      </AsyncBoundary>
    </>
  );
}
