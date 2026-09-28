/**
 * Duplicate detection.
 *
 * The same vacancy routinely appears on the company careers page, an ATS
 * mirror, LinkedIn and an aggregator. Counting it four times inflates the
 * dashboard, so every sighting is merged into a single row and the official
 * company source always wins.
 */

import type { Job, VerificationState } from './types.js';
import { comparable, locationKey, nowIso, parseJobDate, slugify, tokenSimilarity } from './text.js';

/** Fields that, when populated, make a record "richer" and therefore preferred. */
const COMPLETENESS_FIELDS: Array<keyof Job> = [
  'description', 'postedAt', 'closingAt', 'employmentType', 'experienceMin',
  'experienceMax', 'educationRequirement', 'salary', 'requiredSkills', 'department',
];

export function completeness(job: Partial<Job>): number {
  let score = 0;
  for (const f of COMPLETENESS_FIELDS) {
    const v = job[f];
    if (v === null || v === undefined || v === '') continue;
    score += Array.isArray(v) ? (v.length > 0 ? 1 : 0) : 1;
  }
  return score;
}

export function fingerprintFor(job: {
  companyId: string;
  externalJobId?: string | null;
  title: string;
  location?: string | null;
}): string {
  if (job.externalJobId && job.externalJobId.trim()) {
    return `eid:${job.companyId}:${comparable(job.externalJobId)}`;
  }
  return `tl:${job.companyId}:${slugify(job.title)}:${locationKey(job.location) || 'noloc'}`;
}

/**
 * Should these two records be treated as the same vacancy?
 *
 * Tier 1 - same external job id from the same company: definitely a duplicate.
 * Tier 2 - same normalised title + same normalised location: very likely.
 * Tier 3 - fuzzy title match (Jaccard >= 0.82) + same location + posting dates
 *          within 21 days: likely, but only auto-merged when one of the two is
 *          an official source.
 */
export function isDuplicate(a: Job, b: Job): { duplicate: boolean; confidence: number; reason: string } {
  if (a.companyId !== b.companyId) return { duplicate: false, confidence: 0, reason: 'Different companies' };

  if (a.externalJobId && b.externalJobId && comparable(a.externalJobId) === comparable(b.externalJobId)) {
    return { duplicate: true, confidence: 1, reason: `Same job ID "${a.externalJobId}"` };
  }

  const titleSim = tokenSimilarity(a.title, b.title);
  const locA = locationKey(a.location);
  const locB = locationKey(b.location);
  const sameLocation = locA === locB && locA !== '';

  if (comparable(a.title) === comparable(b.title) && sameLocation) {
    return { duplicate: true, confidence: 0.97, reason: 'Identical title and location' };
  }

  if (titleSim >= 0.82 && sameLocation) {
    const gap = dateGapDays(a.postedAt, b.postedAt);
    const closeInTime = gap === null || gap <= 21;
    if (closeInTime && (a.isOfficialSource || b.isOfficialSource)) {
      return {
        duplicate: true,
        confidence: titleSim,
        reason: `Similar title (${Math.round(titleSim * 100)}% match) at the same location`,
      };
    }
  }

  return { duplicate: false, confidence: titleSim, reason: '' };
}

function dateGapDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

export interface MergeOutcome {
  winner: Job;
  losers: Job[];
  alsoSeenAt: string[];
}

/**
 * Choose the record to keep and fold in provenance from the rest.
 * Preference order: official source > verified active > completeness > earliest seen.
 */
export function mergeDuplicates(records: Job[]): MergeOutcome | null {
  if (records.length === 0) return null;
  if (records.length === 1) return { winner: records[0], losers: [], alsoSeenAt: records[0].alsoSeenAt ?? [] };

  const sorted = [...records].sort((a, b) => rank(b) - rank(a));
  const winner = sorted[0];
  const losers = sorted.slice(1);

  const alsoSeenAt = new Set<string>(winner.alsoSeenAt ?? []);
  for (const l of losers) {
    if (l.sourceUrl && l.sourceUrl !== winner.sourceUrl) alsoSeenAt.add(l.sourceUrl);
  }
  for (const u of winner.alsoSeenAt ?? []) alsoSeenAt.add(u);

  // Fill gaps in the winner from losers without overwriting known values.
  const merged: Job = { ...winner };
  for (const l of losers) {
    for (const f of COMPLETENESS_FIELDS) {
      const wv = merged[f];
      const lv = l[f];
      const empty = wv === null || wv === undefined || wv === '' || (Array.isArray(wv) && wv.length === 0);
      const has = lv !== null && lv !== undefined && lv !== '' && (!Array.isArray(lv) || lv.length > 0);
      if (empty && has) (merged as unknown as Record<string, unknown>)[f as string] = lv;
    }
    merged.firstSeenAt = [merged.firstSeenAt, l.firstSeenAt].filter(Boolean).sort()[0] ?? merged.firstSeenAt;
  }
  merged.alsoSeenAt = [...alsoSeenAt];
  merged.updatedAt = nowIso();

  return { winner: merged, losers, alsoSeenAt: [...alsoSeenAt] };
}

function rank(j: Job): number {
  return (
    (j.isOfficialSource ? 1000 : 0) +
    (j.verification === 'VERIFIED_ACTIVE' ? 400 : j.verification === 'UNVERIFIED' ? 50 : 100) +
    completeness(j) * 10 -
    (j.status === 'ACTIVE' ? 0 : 20)
  );
}

/**
 * Reconcile a freshly-collected batch against what is already stored.
 *
 * - Seen again this run  -> ACTIVE, re-verified, last_verified_at bumped.
 * - Not seen, but the source was successfully re-fetched -> REMOVED
 *   ("last verified unavailable"), kept for history.
 * - Not seen because the fetch failed -> status UNKNOWN, left untouched.
 */
export function reconcile(
  existing: Job[],
  collected: Array<{ fingerprint: string; job: Omit<Job, 'id' | 'companyId' | 'status' | 'verification' | 'firstSeenAt' | 'createdAt' | 'updatedAt'> }>,
  opts: { sourceVerified: boolean; sourceUrlFor: (fp: string) => string | null },
): {
  upserts: Array<{ fingerprint: string; job: any; existingId: string | null; isNew: boolean; changed: boolean }>;
  removals: Job[];
} {
  const byFp = new Map(existing.map((j) => [j.dedupeFingerprint, j]));
  const seen = new Set<string>();
  const upserts: Array<{ fingerprint: string; job: any; existingId: string | null; isNew: boolean; changed: boolean }> = [];
  const now = nowIso();

  for (const c of collected) {
    seen.add(c.fingerprint);
    const prev = byFp.get(c.fingerprint);
    const closingAt = c.job.closingAt ? parseJobDate(c.job.closingAt) : null;
    const isExpired = closingAt !== null && Date.parse(closingAt) < Date.now();

    if (!prev) {
      upserts.push({
        fingerprint: c.fingerprint,
        job: {
          ...c.job,
          status: isExpired ? 'EXPIRED' : 'ACTIVE',
          verification: 'VERIFIED_ACTIVE' as VerificationState,
          firstSeenAt: now,
          createdAt: now,
          updatedAt: now,
          lastVerifiedAt: now,
        },
        existingId: null,
        isNew: true,
        changed: true,
      });
      continue;
    }

    // Already closed: keep it closed even if it lingers on a page.
    if (prev.status === 'EXPIRED' || prev.status === 'REMOVED') {
      upserts.push({
        fingerprint: c.fingerprint,
        job: { ...prev },
        existingId: prev.id,
        isNew: false,
        changed: false,
      });
      continue;
    }

    const changed = detectChange(prev, c.job);
    upserts.push({
      fingerprint: c.fingerprint,
      job: {
        ...prev,
        ...c.job,
        closingAt: closingAt ?? prev.closingAt,
        status: isExpired ? 'EXPIRED' : 'ACTIVE',
        verification: 'VERIFIED_ACTIVE' as VerificationState,
        lastVerifiedAt: now,
        updatedAt: now,
      },
      existingId: prev.id,
      isNew: false,
      changed,
    });
  }

  const removals: Job[] = [];
  if (opts.sourceVerified) {
    for (const j of existing) {
      if (seen.has(j.dedupeFingerprint)) continue;
      if (j.status === 'EXPIRED' || j.status === 'REMOVED') continue;
      removals.push({
        ...j,
        status: 'REMOVED',
        verification: 'LAST_VERIFIED_UNAVAILABLE',
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }
  }

  return { upserts, removals };
}

const WATCHED_FIELDS: Array<keyof Job> = [
  'title', 'location', 'description', 'closingAt', 'employmentType',
  'experienceMin', 'experienceMax', 'educationRequirement', 'salary',
];

function detectChange(prev: Job, next: Partial<Job>): boolean {
  for (const f of WATCHED_FIELDS) {
    const a = prev[f];
    const b = next[f];
    const an = Array.isArray(a) ? a.join('|') : (a ?? '');
    const bn = Array.isArray(b) ? b.join('|') : (b ?? '');
    if (comparable(String(an)) !== comparable(String(bn))) return true;
  }
  return false;
}
