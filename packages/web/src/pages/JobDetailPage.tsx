/**
 * Job detail. Renders GET /api/jobs/:id verbatim: the analysis, the extracted
 * requirements and the posting text all come from the server.
 */

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { PageHeader, Section, DescriptionList, TagList } from '../components/Primitives';
import { AsyncBoundary, ErrorState } from '../components/StateViews';
import { EligibilityBadge, EligibilityPanel } from '../components/Eligibility';
import { useJob } from '../hooks/useData';
import { formatDate, experienceLabel, joinOrNull, relativeTime } from '../lib/format';

export function JobDetailPage(): JSX.Element {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, loading, error, refetch } = useJob(jobId);

  if (error) {
    return (
      <>
        <Back />
        <ErrorState error={error} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      <Back />
      <AsyncBoundary loading={loading} error={null} loadingRows={5}>
        {data ? (
          <>
            <PageHeader
              title={data.job.title}
              description={data.job.companyName}
              actions={<EligibilityBadge status={data.job.eligibilityStatus} />}
            />

            <a
              href={data.job.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-primary"
            >
              <ExternalLink aria-hidden className="h-4 w-4" />
              Open Original Job Posting
            </a>

            <div className="mt-6 grid gap-5 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-5">
                <section className="card p-4">
                  <h2 className="mb-3 text-sm font-semibold">Job details</h2>
                  <DescriptionList
                    rows={[
                      ['Job ID', data.job.externalJobId ?? data.job.id],
                      ['Location', joinOrNull([data.job.city, data.job.country ?? data.job.location])],
                      ['Employment type', joinOrNull([data.job.employmentType, data.job.workArrangement])],
                      ['Posted', formatDate(data.job.postedAt)],
                      ['Deadline', formatDate(data.job.closingAt)],
                      ['Experience', experienceLabel(data.job.experienceMin, data.job.experienceMax)],
                      ['Education', data.job.educationRequirement],
                      ['Department', data.job.department ?? data.job.category],
                      ['Salary', data.job.salary],
                    ]}
                  />
                </section>

                {data.job.requiredSkills.length ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Required skills</h2>
                    <TagList items={data.job.requiredSkills} />
                  </section>
                ) : null}

                {data.job.preferredSkills.length ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Preferred skills</h2>
                    <TagList items={data.job.preferredSkills} />
                  </section>
                ) : null}

                {data.job.responsibilities.length ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Responsibilities</h2>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                      {data.job.responsibilities.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {data.job.eligibilityRequirements.length ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Eligibility requirements</h2>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                      {data.job.eligibilityRequirements.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {data.job.description ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">Description</h2>
                    <p className="text-sm whitespace-pre-line text-ink-2">{data.job.description}</p>
                  </section>
                ) : null}
              </div>

              <div className="space-y-5">
                <EligibilityPanel eligibility={data.eligibility} />

                {data.requirements ? (
                  <section className="card p-4">
                    <h2 className="mb-2 text-sm font-semibold">What the posting asks for</h2>
                    <DescriptionList
                      rows={[
                        ['Degree level', data.requirements.degreeLevelRaw ?? data.requirements.degreeLevel],
                        ['Fields', data.requirements.fieldsRaw || null],
                        ['Experience', experienceLabel(data.requirements.experienceMin, data.requirements.experienceMax)],
                        ['Graduation year', data.requirements.gradYearStated
                          ? `${data.requirements.gradYearMin ?? '—'} to ${data.requirements.gradYearMax ?? '—'}`
                          : null],
                        ['Location', data.requirements.locationRaw],
                        ['Relocation', data.requirements.requiresRelocation ? 'Required' : null],
                        [
                          'Work authorization',
                          // null means the posting says nothing at all.
                          data.requirements.workAuthorization === null
                            ? 'Not specified'
                            : data.requirements.workAuthorization.join(', '),
                        ],
                      ]}
                    />
                    {data.requirements.gaps.length ? (
                      <p className="mt-3 text-xs text-muted">
                        Not stated: {data.requirements.gaps.join(', ')}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <section className="card p-4">
                  <h2 className="mb-2 text-sm font-semibold">Source</h2>
                  <p className="text-sm text-ink-2">
                    {data.job.sourceName}
                    {data.job.isOfficialSource ? ' (official)' : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Last verified {relativeTime(data.job.lastVerifiedAt) ?? 'never'}
                    {data.job.verification === 'LAST_VERIFIED_UNAVAILABLE'
                      ? ' — the source no longer lists this posting'
                      : ''}
                  </p>
                  {data.sources.length > 1 ? (
                    <p className="mt-2 text-xs text-muted">Also seen at {data.sources.length - 1} other location(s).</p>
                  ) : null}
                </section>
              </div>
            </div>

            {data.job.alsoSeenAt.length ? (
              <Section title="Also seen at">
                <TagList items={data.job.alsoSeenAt} />
              </Section>
            ) : null}
          </>
        ) : null}
      </AsyncBoundary>
    </>
  );
}

function Back(): JSX.Element {
  return (
    <Link to="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
      <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
      All jobs
    </Link>
  );
}
