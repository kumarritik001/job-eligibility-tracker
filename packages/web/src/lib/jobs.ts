/**
 * Filter helpers that mirror the server's own bucketing rules.
 *
 * These are *filters*, not verdicts. The rules below are copied from
 * packages/server/src/services/store.ts (queryJobs) so that filtering a list
 * already in the browser agrees with what GET /api/jobs would have returned.
 * No eligibility decision is ever made here.
 */

import type { Job, PostedWindow } from '../types/api';

export type ExperienceBucket = 'ENTRY' | 'MID' | 'SENIOR';

/** Matches store.ts: ENTRY is null or <= 1, MID is 2..4, SENIOR is > 4. */
export function experienceBucket(job: Pick<Job, 'experienceMin'>): ExperienceBucket {
  const min = job.experienceMin;
  if (min === null || min === undefined || min <= 1) return 'ENTRY';
  if (min <= 4) return 'MID';
  return 'SENIOR';
}

export const EXPERIENCE_LABELS: Record<ExperienceBucket, string> = {
  ENTRY: 'Entry level (0–1 yr)',
  MID: 'Mid level (2–4 yrs)',
  SENIOR: 'Senior (5+ yrs)',
};

/** Mirrors POSTED_WINDOW_DAYS in the server. */
export const POSTED_WINDOW_DAYS: Record<Exclude<PostedWindow, 'ANY' | 'OLDER'>, number> = {
  TODAY: 1,
  LAST_3_DAYS: 3,
  LAST_7_DAYS: 7,
  LAST_14_DAYS: 14,
  LAST_30_DAYS: 30,
};

export const POSTED_LABELS: Record<PostedWindow, string> = {
  ANY: 'Any time',
  TODAY: 'Today',
  LAST_3_DAYS: 'Last 3 days',
  LAST_7_DAYS: 'Last 7 days',
  LAST_14_DAYS: 'Last 14 days',
  LAST_30_DAYS: 'Last 30 days',
  OLDER: 'Older than 30 days',
};

export function matchesPostedWindow(job: Pick<Job, 'postedAt'>, window: PostedWindow): boolean {
  if (window === 'ANY') return true;
  const posted = job.postedAt ? new Date(job.postedAt).getTime() : NaN;
  if (window === 'OLDER') {
    // The server treats a null posted date as "older".
    if (Number.isNaN(posted)) return true;
    return posted < Date.now() - 30 * 86_400_000;
  }
  if (Number.isNaN(posted)) return false;
  return posted >= Date.now() - (POSTED_WINDOW_DAYS[window] ?? 30) * 86_400_000;
}
