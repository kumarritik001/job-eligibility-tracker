/**
 * Company list: search, add, research, remove.
 *
 * Counts are the rollup fields the server attaches to each Company row; the
 * table never counts anything itself.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/Primitives';
import { AsyncBoundary, EmptyState } from '../components/StateViews';
import { AddCompanyModal } from '../components/AddCompanyModal';
import { ResearchPanel } from '../components/ResearchPanel';
import { useAuth } from '../hooks/useAuth';
import { useCompanies, useRemoveCompany, useResearch } from '../hooks/useData';
import { relativeTime } from '../lib/format';

export function CompaniesPage(): JSX.Element {
  const { status } = useAuth();
  const enabled = status === 'authenticated';
  const { data, loading, error, refetch } = useCompanies(enabled);
  const { remove, busyId } = useRemoveCompany();
  const [term, setTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const research = useResearch(pendingId ?? undefined, refetch);

  const companies = useMemo(() => {
    const rows = data?.companies ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(needle));
  }, [data, term]);

  return (
    <>
      <PageHeader
        title="Companies"
        description="Companies you track, with live counts from the latest research."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            Add company
          </button>
        }
      />

      <div className="card mb-4 flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Search aria-hidden className="absolute top-2.5 left-2.5 h-4 w-4 text-muted" />
          <input
            className="input pl-8"
            placeholder="Search companies"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label="Search companies"
          />
        </div>
        {term ? (
          <button type="button" onClick={() => setTerm('')} className="btn btn-secondary">
            Clear
          </button>
        ) : null}
      </div>

      {pendingId ? (
        <div className="mb-4">
          <ResearchPanel phase={research.phase} steps={research.steps} run={research.run} onDismiss={research.reset} />
        </div>
      ) : null}

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingRows={4}
        isEmpty={!loading && !error && companies.length === 0}
        empty={
          <EmptyState
            title={term ? 'No companies match that search' : 'No companies tracked yet'}
            description={
              term
                ? 'Try a different name, or clear the search to see everything you track.'
                : 'Add a company and we will research its careers page for openings you qualify for.'
            }
            action={
              term ? (
                <button type="button" onClick={() => setTerm('')} className="btn btn-secondary">
                  Clear search
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
                  <AddFirstCompany />
                </button>
              )
            }
          />
        }
      >
        {companies.length ? (
          <>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Companies you track, with job counts and last research time</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="px-4 py-2.5 font-medium">Company</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Active</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Eligible</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Uncertain</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Last updated</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {companies.map((company) => {
                    const researching = pendingId === company.id && research.phase !== 'idle';
                    return (
                      <tr key={company.id}>
                        <th scope="row" className="px-4 py-3 text-left font-medium">
                          <Link to={`/companies/${company.id}`} className="hover:text-brand hover:underline">
                            {company.name}
                          </Link>
                          {company.careersUrl ? (
                            <a
                              href={company.careersUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-muted hover:text-brand"
                            >
                              careers
                              <ExternalLink aria-hidden className="h-3 w-3" />
                              <span className="sr-only">site for {company.name} (opens in a new tab)</span>
                            </a>
                          ) : null}
                        </th>
                        <td className="px-4 py-3 text-right tabular-nums">{company.activeJobs}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-eligible">
                          {company.eligibleJobs}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-uncertain">{company.uncertainJobs}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {relativeTime(company.lastResearchedAt) ?? 'Never researched'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => {
                                setPendingId(company.id);
                                void research.start(company.id);
                              }}
                              disabled={researching}
                            >
                              <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${researching ? 'animate-spin' : ''}`} />
                              <span className="sr-only">Research now: </span>
                              Research Now
                            </button>
                            {confirmId === company.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={async () => {
                                    setConfirmId(null);
                                    const ok = await remove(company.id);
                                    if (ok) refetch();
                                  }}
                                  disabled={busyId === company.id}
                                >
                                  Confirm
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => setConfirmId(null)}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setConfirmId(company.id)}
                                aria-label={`Remove ${company.name}`}
                              >
                                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              {companies.length} of {data?.companies.length ?? 0} companies shown.
            </p>
          </>
        ) : null}
      </AsyncBoundary>

      <AddCompanyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(companyId) => {
          setModalOpen(false);
          setPendingId(companyId);
          refetch();
        }}
      />
    </>
  );
}

function AddFirstCompany(): JSX.Element {
  return (
    <>
      <Plus aria-hidden className="h-4 w-4" />
      Add a company
    </>
  );
}
