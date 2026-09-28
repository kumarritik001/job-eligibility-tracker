/**
 * The live research pipeline.
 *
 * Every stage reports through the step callback so the UI can show real
 * progress, and every stage records what it could and could not verify. A
 * failed run never erases previously verified jobs -- it only updates the
 * verification timestamp and notes.
 */

import {
  analyzeEligibility,
  canonicalizeSkillList,
  extractRequirements,
  fingerprintFor,
  isDuplicate,
  mergeDuplicates,
  normalizeCompanyName,
  parseJobDate,
  reconcile,
  type Company,
  type Job,
  type JobRequirements,
  type ResearchStep,
  type ResearchStepKey,
  type UserProfile,
} from '@jet/shared';
import { load } from 'cheerio';
import { config } from '../config.js';
import { politeFetch, maxPages, userAgent } from './http.js';
import { resolveCareers, atsProviderFor } from './careersUrl.js';
import { enrich, generic, runAdapter, detectProvider } from './ats.js';
import {
  extractHeuristic,
  extractJsonLd,
  extractMicrodata,
  isProbablyJobBoard,
  looksLikeJobDetailPage,
  mergeExtracted,
  partitionDescription,
  type RawJob,
} from './extract.js';
import { searchWeb, jobsQuery, providerName } from './search.js';
import { loadProfile, loadCompanyJobs, upsertJob, saveEligibility, applyRemovals, markResearched } from '../services/store.js';
import { createResearchRun, finishResearchRun, recordStep } from '../services/runs.js';
import { maybeEnrichWithAi } from '../services/ai.js';
import { uid, nowIso } from '../db/index.js';

export interface ProgressReporter {
  (step: ResearchStep): void;
}

const STEP_LABELS: Record<ResearchStepKey, string> = {
  RESOLVING_CAREERS_URL: 'Finding company careers page',
  SEARCHING_OPENINGS: 'Searching current openings',
  EXTRACTING_POSTINGS: 'Extracting job postings',
  CHECKING_DATES: 'Checking posting dates',
  VERIFYING_SOURCES: 'Verifying sources',
  ANALYZING_ELIGIBILITY: 'Analyzing eligibility',
  REMOVING_DUPLICATES: 'Removing duplicates',
  UPDATING_DASHBOARD: 'Updating dashboard',
};

export const STEP_ORDER: ResearchStepKey[] = [
  'RESOLVING_CAREERS_URL',
  'SEARCHING_OPENINGS',
  'EXTRACTING_POSTINGS',
  'CHECKING_DATES',
  'VERIFYING_SOURCES',
  'ANALYZING_ELIGIBILITY',
  'REMOVING_DUPLICATES',
  'UPDATING_DASHBOARD',
];

export interface ResearchSummary {
  runId: string;
  company: Company;
  jobsFound: number;
  jobsNew: number;
  jobsUpdated: number;
  jobsRemoved: number;
  eligibleJobs: number;
  ineligibleJobs: number;
  uncertainJobs: number;
  sourcesTried: string[];
  sourcesOk: string[];
  notes: string[];
  error: string | null;
}

class Steps {
  constructor(
    private report: ProgressReporter,
    private runId: string,
  ) {}

  private emit(step: ResearchStep): void {
    this.report(step);
    recordStep(this.runId, step);
  }

  async run<T>(key: ResearchStepKey, detail: string | undefined, fn: () => Promise<T> | T): Promise<T> {
    const startedAt = nowIso();
    this.emit({ key, label: STEP_LABELS[key], state: 'running', detail, startedAt });
    try {
      const out = await fn();
      this.emit({ key, label: STEP_LABELS[key], state: 'done', detail, startedAt, endedAt: nowIso() });
      return out;
    } catch (err) {
      this.emit({
        key,
        label: STEP_LABELS[key],
        state: 'failed',
        detail: err instanceof Error ? err.message : String(err),
        startedAt,
        endedAt: nowIso(),
      });
      throw err;
    }
  }

  skip(key: ResearchStepKey, detail: string): void {
    const at = nowIso();
    this.emit({ key, label: STEP_LABELS[key], state: 'skipped', detail, startedAt: at, endedAt: at });
  }
}

/**
 * Run a full research pass for one company.
 * `careersUrlOverride` is used when the user picked a specific careers page.
 */
export async function researchCompany(
  company: Company,
  report: ProgressReporter,
  careersUrlOverride?: string | null,
  existingRunId?: string | null,
): Promise<ResearchSummary> {
  const notes: string[] = [];
  const sourcesTried: string[] = [];
  const sourcesOk: string[] = [];
  const runId = existingRunId ?? createResearchRun(company.id, company.userId);
  const steps = new Steps(report, runId);

  let error: string | null = null;

  try {
    const profile = loadProfile(company.userId);
    if (!profile) throw new Error('No user profile found. Complete your profile before researching companies.');

    // --- 1. Careers URL --------------------------------------------------
    const resolution = await steps.run(
      'RESOLVING_CAREERS_URL',
      undefined,
      async () => {
        if (careersUrlOverride) {
          sourcesTried.push(careersUrlOverride);
          return { careersUrl: careersUrlOverride, notes: [`Using the careers page you selected: ${careersUrlOverride}`] as string[], official: company.officialWebsite };
        }
        const r = await resolveCareers(company.name, company.officialWebsite);
        const best = r.candidates[0];
        if (!best) {
          throw new Error(
            'Could not discover a careers page for this company. Add the company\'s careers URL manually, or configure a search API key.',
          );
        }
        sourcesTried.push(...r.candidates.map((c) => c.careersUrl ?? '').filter(Boolean));
        return { careersUrl: best.careersUrl!, notes: r.notes, official: r.officialWebsite ?? company.officialWebsite };
      },
    );
    notes.push(...resolution.notes);
    const careersUrl = resolution.careersUrl;
    sourcesOk.push(careersUrl);

    // --- 2. Search current openings --------------------------------------
    const collected = await steps.run(
      'SEARCHING_OPENINGS',
      careersUrl,
      async () => {
        const sourceName = `${company.name} (official careers)`;
        const isOfficial = true;
        const result = await runAdapter(careersUrl, sourceName, isOfficial);
        sourcesTried.push(careersUrl);
        if (result.detail) notes.push(`Primary source: ${result.detail}`);
        let jobs = result.jobs;
        let authoritative = result.authoritative;

        // A careers landing page is often just a link list -- follow job links.
        if (jobs.length === 0) {
          jobs = await followJobLinks(careersUrl, sourceName, isOfficial);
          authoritative = jobs.length > 0;
        }

        // Last resort: a search for the company's postings on job boards.
        if (jobs.length === 0 && providerName()) {
          const found = await searchBoards(company.name, sourceName);
          if (found.length > 0) {
            notes.push(
              `The official careers page yielded no parseable postings. ${found.length} postings were found on third-party job boards instead, so these are marked as non-official sources.`,
            );
            jobs = found;
            authoritative = false;
          }
        }

        if (jobs.length === 0) {
          notes.push(
            result.detail ?? 'No job postings could be parsed from the careers page. The source could not be verified.',
          );
        }
        return { jobs, authoritative };
      },
    );

    if (collected.jobs.length === 0) {
      // Record the attempt, keep existing data intact.
      finishResearchRun(runId, {
        status: 'FAILED',
        jobsFound: 0, jobsNew: 0, jobsUpdated: 0, jobsRemoved: 0, eligibleJobs: 0,
        sourcesTried, sourcesOk, errorMessage: notes[notes.length - 1] ?? 'No postings found.',
      });
      return {
        runId, company,
        jobsFound: 0, jobsNew: 0, jobsUpdated: 0, jobsRemoved: 0,
        eligibleJobs: 0, ineligibleJobs: 0, uncertainJobs: 0,
        sourcesTried, sourcesOk, notes, error: notes[notes.length - 1] ?? 'No postings found.',
      };
    }

    // --- 3. Extract + enrich full posting text ---------------------------
    const enriched = await steps.run(
      'EXTRACTING_POSTINGS',
      `${collected.jobs.length} listing(s) found`,
      async () => {
        const budget = Math.max(3, Math.min(10, Math.ceil(maxPages() / 2)));
        const out = await enrich(collected.jobs, `${company.name} (official careers)`, true, budget);
        for (const j of out) {
          const parts = partitionDescription(j.description ?? '');
          j.responsibilities = j.responsibilities.length ? j.responsibilities : parts.responsibilities;
          j.eligibilityRequirements = j.eligibilityRequirements.length ? j.eligibilityRequirements : parts.requirements;
          j.educationRequirement = j.educationRequirement ?? firstDegreeLine(j.description ?? '');
          j.requiredSkills = canonicalizeSkillList(parts.skills);
          j.preferredSkills = canonicalizeSkillList(parts.preferred);
        }
        return out;
      },
    );

    // --- 4. Check dates ---------------------------------------------------
    await steps.run('CHECKING_DATES', undefined, () => {
      let withPosted = 0;
      let withDeadline = 0;
      for (const j of enriched) {
        if (j.postedAt) j.postedAt = parseJobDate(j.postedAt);
        if (j.closingAt) j.closingAt = parseJobDate(j.closingAt);
        if (j.postedAt) withPosted += 1;
        if (j.closingAt) withDeadline += 1;
      }
      const total = enriched.length;
      notes.push(
        `Dates: ${withPosted}/${total} postings have a posting date and ${withDeadline}/${total} have a closing date. Where a date is absent the UI shows "Not specified in posting".`,
      );
      return { withPosted, withDeadline };
    });

    // --- 5. Deduplicate ---------------------------------------------------
    const deduped = await steps.run('REMOVING_DUPLICATES', undefined, () => {
      const groups = new Map<string, RawJob[]>();
      for (const j of enriched) {
        const key = fingerprintFor({
          companyId: company.id,
          externalJobId: j.externalJobId,
          title: j.title,
          location: j.location,
        });
        const arr = groups.get(key) ?? [];
        arr.push(j);
        groups.set(key, arr);
      }
      const before = enriched.length;
      const out: RawJob[] = [];
      let removed = 0;
      for (const arr of groups.values()) {
        if (arr.length === 1) {
          out.push(arr[0]);
          continue;
        }
        out.push(...mergeExtracted([arr]));
        removed += arr.length - 1;
      }
      if (removed > 0) notes.push(`Merged ${removed} duplicate listing(s) from the same company.`);
      return { jobs: out, before, removed };
    });

    // --- 6. Verify sources -----------------------------------------------
    await steps.run('VERIFYING_SOURCES', undefined, () => {
      if (!collected.authoritative) {
        notes.push(
          'Listings came from a source that could not be confirmed as an official company channel, so each is stored with "Last verified" reflecting the fetch, not a re-check of the application page.',
        );
      }
    });

    // --- 7. Reconcile against what we already had, then persist ----------
    const existing = loadCompanyJobs(company.id, company.userId, ['ACTIVE', 'EXPIRED', 'REMOVED', 'UNKNOWN']);
    const existingJobs: Job[] = existing.map(toJob);

    const result = reconcile(
      existingJobs,
      deduped.jobs.map((j) => {
        const fingerprint = fingerprintFor({
          companyId: company.id, externalJobId: j.externalJobId, title: j.title, location: j.location,
        });
        return {
          fingerprint,
          job: {
            externalJobId: j.externalJobId,
            title: j.title,
            department: j.department,
            category: j.category,
            location: j.location,
            city: null,
            country: null,
            employmentType: j.employmentType,
            workArrangement: /remote/i.test(j.location ?? '') ? 'Remote' : /hybrid/i.test(j.location ?? '') ? 'Hybrid' : null,
            postedAt: j.postedAt,
            closingAt: j.closingAt,
            experienceMin: j.experienceMin,
            experienceMax: j.experienceMax,
            educationRequirement: j.educationRequirement,
            requiredField: null,
            requiredSkills: j.requiredSkills,
            preferredSkills: j.preferredSkills,
            certifications: [] as string[],
            salary: j.salary,
            description: j.description,
            responsibilities: j.responsibilities,
            eligibilityRequirements: j.eligibilityRequirements,
            sourceUrl: j.url,
            sourceName: j.sourceName,
            isOfficialSource: j.isOfficial,
            alsoSeenAt: [] as string[],
            dedupeFingerprint: fingerprint,
            lastVerifiedAt: null,
          },
        };
      }),
      { sourceVerified: collected.authoritative, sourceUrlFor: () => careersUrl },
    );

    // Guard against re-adding a vacancy we already track under another source.
    const accepted: typeof result.upserts = [];
    for (const up of result.upserts) {
      const probe = { ...up.job, id: 'new', companyId: company.id, status: 'ACTIVE', verification: 'UNVERIFIED' } as unknown as Job;
      const clash = existingJobs.find(
        (other) => other.id !== up.existingId && isDuplicate(other, probe).duplicate,
      );
      if (clash) {
        notes.push(`"${up.job.title}" was already tracked (${clash.sourceName}); not counted twice.`);
        continue;
      }
      accepted.push(up);
    }

    const persist = await steps.run('UPDATING_DASHBOARD', undefined, () => {
      let newCount = 0;
      let updatedCount = 0;
      for (const up of accepted) {
        const jobId = upsertJob(company.id, company.userId, up.job, up.fingerprint, up.isNew, up.existingId);
        if (!jobId) continue;
        if (up.isNew) newCount += 1;
        else if (up.changed) updatedCount += 1;
      }
      const removed = applyRemovals(company.userId, result.removals);
      for (const id of removed) {
        const gone = result.removals.find((r) => r.id === id);
        if (gone) {
          notes.push(`"${gone.title}" is no longer listed by the source. It is kept in history and excluded from the active count.`);
        }
      }
      markResearched(company.userId, company.id);
      return { newCount, updatedCount, removedCount: removed.length };
    });

    // --- 8. Eligibility ---------------------------------------------------
    const analysis = await steps.run('ANALYZING_ELIGIBILITY', undefined, async () => {
      const fresh = loadCompanyJobs(company.id, company.userId, ['ACTIVE']);
      let eligible = 0;
      let ineligible = 0;
      let uncertain = 0;
      for (const row of fresh) {
        const job = toJob(row);
        // Extract from the posting text every run so a changed description is
        // re-analysed; the stored copy is only a cache for the job detail view.
        let requirements = extractRequirements({
          title: job.title,
          description: job.description,
          educationRequirement: job.educationRequirement,
          experienceMin: job.experienceMin,
          experienceMax: job.experienceMax,
          location: job.location,
          employmentType: job.employmentType,
          requirementsText: job.eligibilityRequirements.join('\n'),
        });
        // Optional LLM second opinion. Only quoted, verifiable additions survive.
        const enriched = await maybeEnrichWithAi(requirements, job.description ?? '', job.title);
        if (enriched) {
          notes.push(`"${job.title}": an AI pass was used to read a thin posting. Every added requirement quotes the posting text, and the verdict is still decided by the rule engine.`);
          requirements = enriched;
        }
        const resultRow = analyzeEligibility(job, profile, requirements);
        saveEligibility(resultRow, requirements);
        if (resultRow.status === 'ELIGIBLE') eligible += 1;
        else if (resultRow.status === 'INELIGIBLE') ineligible += 1;
        else uncertain += 1;
      }
      return { eligible, ineligible, uncertain };
    });

    finishResearchRun(runId, {
      status: 'COMPLETED',
      jobsFound: deduped.jobs.length,
      jobsNew: persist.newCount,
      jobsUpdated: persist.updatedCount,
      jobsRemoved: result.removals.length,
      eligibleJobs: analysis.eligible,
      sourcesTried,
      sourcesOk,
      errorMessage: null,
    });

    return {
      runId,
      company: { ...company, lastResearchedAt: nowIso() },
      jobsFound: deduped.jobs.length,
      jobsNew: persist.newCount,
      jobsUpdated: persist.updatedCount,
      jobsRemoved: result.removals.length,
      eligibleJobs: analysis.eligible,
      ineligibleJobs: analysis.ineligible,
      uncertainJobs: analysis.uncertain,
      sourcesTried,
      sourcesOk,
      notes,
      error: null,
    };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    finishResearchRun(runId, {
      status: 'FAILED',
      jobsFound: 0, jobsNew: 0, jobsUpdated: 0, jobsRemoved: 0, eligibleJobs: 0,
      sourcesTried, sourcesOk, errorMessage: error,
    });
    return {
      runId, company,
      jobsFound: 0, jobsNew: 0, jobsUpdated: 0, jobsRemoved: 0,
      eligibleJobs: 0, ineligibleJobs: 0, uncertainJobs: 0,
      sourcesTried, sourcesOk,
      notes: [...notes, error],
      error,
    };
  }
}

// ---------------------------------------------------------------------------
// Link following
// ---------------------------------------------------------------------------

/** A careers page is often a menu. Follow links that look like job detail pages. */
async function followJobLinks(careersUrl: string, sourceName: string, isOfficial: boolean): Promise<RawJob[]> {
  const res = await politeFetch(careersUrl, { maxBytes: 4 * 1024 * 1024 });
  if (!res.ok || !res.contentType.includes('html')) return [];
  const $ = load(res.body);

  const seen = new Set<string>();
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, res.finalUrl).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    if (!/job|vacanc|opening|position|posting|career/i.test(abs)) return;
    seen.add(abs);
    links.push(abs);
  });

  const budget = Math.min(6, maxPages());
  const jobs: RawJob[] = [];
  for (const url of links.slice(0, budget)) {
    const page = await politeFetch(url, { maxBytes: 2 * 1024 * 1024 });
    if (!page.ok || !page.contentType.includes('html')) continue;
    if (!looksLikeJobDetailPage(page.body)) continue;
    const found = mergeExtracted([
      extractJsonLd(page.body, page.finalUrl, sourceName, isOfficial),
      extractMicrodata(page.body, page.finalUrl, sourceName, isOfficial),
    ]);
    if (found.length > 0) {
      jobs.push(found[0]);
      continue;
    }
    const heur = extractHeuristic(page.body, page.finalUrl, sourceName, isOfficial);
    if (heur.length > 0) jobs.push(...heur.slice(0, 1));
  }
  return jobs;
}

/** Search job boards for the company. Always marked as non-official. */
async function searchBoards(companyName: string, sourceName: string): Promise<RawJob[]> {
  const results = await searchWeb(jobsQuery(companyName), { intent: 'jobs', limit: 12 });
  const out: RawJob[] = [];
  const boardHosts = /greenhouse\.io|lever\.co|workdayjobs\.com|smartrecruiters\.com|ashbyhq\.com|workable\.com|personio\.com|myworkdayjobs\.com/i;
  for (const r of results) {
    if (!boardHosts.test(r.host) && !/\/(job|jobs|career|careers|vacancy|position)s?\//i.test(r.url)) continue;
    if (boardHosts.test(r.host)) {
      // For ATS hosts, read the board directly rather than trusting a search hit.
      const res = await runAdapter(r.url, sourceName, false);
      out.push(...res.jobs);
    } else {
      const page = await politeFetch(r.url, { maxBytes: 2 * 1024 * 1024 });
      if (!page.ok || !page.contentType.includes('html')) continue;
      const found = mergeExtracted([
        extractJsonLd(page.body, page.finalUrl, sourceName, false),
        extractMicrodata(page.body, page.finalUrl, sourceName, false),
      ]);
      if (found.length > 0) {
        out.push(...found);
      } else if (isProbablyJobBoard(load(page.body))) {
        out.push(...extractHeuristic(page.body, page.finalUrl, sourceName, false));
      }
    }
    if (out.length >= 40) break;
  }
  return out;
}

function firstDegreeLine(text: string): string | null {
  for (const s of text.split(/(?<=[.;!?])\s+|\n+|•+/)) {
    const t = s.trim();
    if (t.length > 12 && t.length < 300 && /\b(bachelor|b\.?tech|b\.?sc|b\.?e\.?|master|m\.?tech|degree in)\b/i.test(t)) return t;
  }
  return null;
}

function toJob(row: Record<string, any>): Job {
  return {
    id: row.id,
    companyId: row.company_id ?? row.companyId,
    externalJobId: row.external_job_id,
    title: row.title,
    department: row.department,
    category: row.category,
    location: row.location,
    city: row.city,
    country: row.country,
    employmentType: row.employment_type,
    workArrangement: row.work_arrangement,
    postedAt: row.posted_at,
    closingAt: row.closing_at,
    experienceMin: row.experience_min,
    experienceMax: row.experience_max,
    educationRequirement: row.education_requirement,
    requiredField: row.required_field,
    requiredSkills: JSON.parse(row.required_skills || '[]'),
    preferredSkills: JSON.parse(row.preferred_skills || '[]'),
    certifications: JSON.parse(row.certifications || '[]'),
    salary: row.salary,
    description: row.description,
    responsibilities: JSON.parse(row.responsibilities || '[]'),
    eligibilityRequirements: JSON.parse(row.eligibility_requirements || '[]'),
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    isOfficialSource: row.is_official_source === 1,
    alsoSeenAt: JSON.parse(row.also_seen_at || '[]'),
    status: row.status,
    verification: row.verification,
    dedupeFingerprint: row.dedupe_fingerprint,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { detectProvider, generic, userAgent };
