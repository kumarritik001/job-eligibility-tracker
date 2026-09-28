/**
 * Reusable job card.
 *
 * Used by the dashboard, the job list and the company detail page. The
 * eligibility badge is the server's verdict; eligible rows additionally get a
 * heavier border, a tinted background and a "Recommended" text label so the
 * emphasis survives a colour-blind or monochrome rendering.
 */

import { Link } from 'react-router-dom';
import { CalendarClock, MapPin } from 'lucide-react';
import { EligibilityBadge } from './Eligibility';
import { daysUntil, experienceLabel, formatDate, joinOrNull, relativeTime } from '../lib/format';
import type { JobListItem } from '../types/api';

export function JobCard({
  job,
  showCompany = true,
}: {
  job: JobListItem;
  showCompany?: boolean;
}): JSX.Element {
  const isEligible = job.eligibilityStatus === 'ELIGIBLE';
  const deadline = daysUntil(job.closingAt);
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
  const location = joinOrNull([job.city, job.country ?? job.location]);
  const verified = relativeTime(job.lastVerifiedAt);

  return (
    <article
      data-eligibility={job.eligibilityStatus ?? 'NONE'}
      className={`card relative p-4 transition-colors ${
        isEligible ? 'border-eligible/50 bg-eligible-soft/40 ring-1 ring-eligible/20' : 'hover:bg-surface-2'
      }`}
    >
      {isEligible ? (
        <span className="absolute top-0 right-0 rounded-bl-md bg-eligible px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Recommended
        </span>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate pr-24 text-sm font-semibold">
            <Link to={`/jobs/${job.id}`} className="hover:text-brand hover:underline">
              {job.title}
            </Link>
          </h3>
          {showCompany ? (
            <p className="mt-0.5 truncate text-sm text-muted">
              <Link to={`/companies/${job.companyId}`} className="hover:text-brand hover:underline">
                {job.companyName}
              </Link>
            </p>
          ) : null}
        </div>
        <EligibilityBadge status={job.eligibilityStatus} />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
        {location ? (
          <div className="flex items-center gap-1.5">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted" />
            <dt className="sr-only">Location</dt>
            <dd>{location}</dd>
          </div>
        ) : null}

        {job.employmentType ? (
          <div>
            <dt className="sr-only">Employment type</dt>
            <dd>{job.employmentType}</dd>
          </div>
        ) : null}

        {experience ? (
          <div>
            <dt className="sr-only">Experience</dt>
            <dd>{experience}</dd>
          </div>
        ) : null}

        {job.postedAt ? (
          <div>
            <dt className="sr-only">Posted</dt>
            <dd>Posted {formatDate(job.postedAt)}</dd>
          </div>
        ) : null}

        {job.closingAt ? (
          <div
            className={`flex items-center gap-1.5 ${
              deadline !== null && deadline <= 3 ? 'font-semibold text-ineligible' : ''
            }`}
          >
            <CalendarClock aria-hidden className="h-3.5 w-3.5" />
            <dt className="sr-only">Deadline</dt>
            <dd>
              {deadline !== null && deadline >= 0
                ? `Closes in ${deadline} day${deadline === 1 ? '' : 's'}`
                : 'Closing date passed'}
            </dd>
          </div>
        ) : null}
      </dl>

      {job.educationRequirement ? (
        <p className="mt-2 line-clamp-1 text-xs text-muted">{job.educationRequirement}</p>
      ) : null}

      <p className="mt-2.5 text-[11px] text-muted">
        {verified ? `Last verified ${verified}` : 'Not yet verified against the source'}
        {job.verification === 'LAST_VERIFIED_UNAVAILABLE' ? ' — source no longer lists it' : ''}
      </p>
    </article>
  );
}
