/**
 * Repository layer.
 *
 * Every read/write the API and the research engine need goes through here so
 * row shape (snake_case) and domain shape (camelCase) never leak into each
 * other, and so a driver swap only touches this file.
 */

import type {
  AppNotification,
  Company,
  CompanyCandidate,
  DashboardSummary,
  EligibilityResult,
  EmailPrefs,
  Job,
  JobQuery,
  JobRequirements,
  JobStatus,
  ProfilePatch,
  RefreshMode,
  UserProfile,
  VerificationState,
} from '@jet/shared';
import { daysBetween, normalizeCompanyName, nowIso, slugify } from '@jet/shared';
import { all, bool, j, num, one, run, str, toArray, toObject, uid } from '../db/index.js';

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function mapProfile(row: Record<string, any>): UserProfile {
  return {
    userId: row.user_id,
    name: row.name ?? '',
    email: row.email ?? '',
    degree: row.degree ?? '',
    branch: row.branch ?? '',
    college: str(row.college),
    graduationYear: num(row.graduation_year) ?? 0,
    cgpa: num(row.cgpa),
    cgpaScale: num(row.cgpa_scale) ?? 10,
    gateScore: num(row.gate_score),
    gateRank: num(row.gate_rank),
    gateYear: num(row.gate_year),
    gateBranch: str(row.gate_branch),
    yearsOfExperience: num(row.years_of_experience) ?? 0,
    minDesiredExperience: num(row.min_desired_experience) ?? 0,
    maxDesiredExperience: num(row.max_desired_experience) ?? 5,
    internships: row.internships ?? '',
    certifications: toArray(row.certifications),
    skills: toArray(row.skills),
    workAuthorization: toArray(row.work_authorization),
    preferredLocations: toArray(row.preferred_locations),
    preferredJobTypes: toArray(row.preferred_job_types),
    willingToRelocate: bool(row.willing_to_relocate),
    updatedAt: row.updated_at,
  };
}

export function loadProfile(userId: string): UserProfile | null {
  const row = one<Record<string, any>>(
    `SELECT p.*, u.email FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`,
    [userId],
  );
  return row ? mapProfile(row) : null;
}

export function saveProfile(userId: string, patch: ProfilePatch): UserProfile {
  const existing = loadProfile(userId);
  if (!existing) throw new Error('Profile not initialised');
  const next: UserProfile = { ...existing, ...patch };
  const at = nowIso();
  run(
    `UPDATE user_profiles SET
       name = ?, degree = ?, branch = ?, college = ?, graduation_year = ?, cgpa = ?, cgpa_scale = ?,
       gate_score = ?, gate_rank = ?, gate_year = ?, gate_branch = ?,
       years_of_experience = ?, min_desired_experience = ?, max_desired_experience = ?,
       internships = ?, certifications = ?, skills = ?,
       work_authorization = ?, preferred_locations = ?, preferred_job_types = ?, willing_to_relocate = ?,
       updated_at = ?
     WHERE user_id = ?`,
    [
      next.name, next.degree, next.branch, next.college, next.graduationYear, next.cgpa, next.cgpaScale,
      next.gateScore, next.gateRank, next.gateYear, next.gateBranch,
      next.yearsOfExperience, next.minDesiredExperience, next.maxDesiredExperience,
      next.internships, j(next.certifications), j(next.skills),
      j(next.workAuthorization), j(next.preferredLocations), j(next.preferredJobTypes),
      next.willingToRelocate ? 1 : 0, at, userId,
    ],
  );
  return loadProfile(userId)!;
}

/** Which profile fields still need an answer before research can be trusted. */
export function profileGaps(p: UserProfile | null): string[] {
  if (!p) return ['No profile exists yet.'];
  const gaps: string[] = [];
  if (!p.degree.trim()) gaps.push('Degree not set');
  if (!p.branch.trim()) gaps.push('Branch not set');
  if (!p.graduationYear) gaps.push('Graduation year not set');
  if (!p.skills.length) gaps.push('No skills listed, so skill matching will be uncertain');
  if (!p.preferredLocations.length) gaps.push('No preferred locations set, so location matching will be uncertain');
  return gaps;
}

export function profileComplete(p: UserProfile | null): boolean {
  return Boolean(p && p.degree.trim() && p.branch.trim() && p.graduationYear && p.skills.length);
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

function mapCompany(row: Record<string, any>): Company {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    normalizedName: row.normalized_name,
    officialWebsite: str(row.official_website),
    careersUrl: str(row.careers_url),
    logoUrl: str(row.logo_url),
    atsProvider: str(row.ats_provider),
    careersUrlConfidence: num(row.careers_url_confidence),
    careersUrlSource: str(row.careers_url_source),
    addedAt: row.added_at,
    lastResearchedAt: str(row.last_researched_at),
    nextResearchAt: str(row.next_research_at),
    refreshMode: row.refresh_mode as RefreshMode,
    activeJobs: num(row.active_jobs) ?? 0,
    eligibleJobs: num(row.eligible_jobs) ?? 0,
    ineligibleJobs: num(row.ineligible_jobs) ?? 0,
    uncertainJobs: num(row.uncertain_jobs) ?? 0,
    unverifiedJobs: num(row.unverified_jobs) ?? 0,
  };
}

/**
 * Live rollup counts. Computed in SQL so the dashboard never shows a number
 * that disagrees with the job list behind the "view all" link.
 */
const COMPANY_ROLLUP = `
  SELECT c.*,
    (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'ACTIVE') AS active_jobs,
    (SELECT COUNT(*) FROM jobs j JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
       WHERE j.company_id = c.id AND j.status = 'ACTIVE' AND e.status = 'ELIGIBLE') AS eligible_jobs,
    (SELECT COUNT(*) FROM jobs j JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
       WHERE j.company_id = c.id AND j.status = 'ACTIVE' AND e.status = 'INELIGIBLE') AS ineligible_jobs,
    (SELECT COUNT(*) FROM jobs j JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
       WHERE j.company_id = c.id AND j.status = 'ACTIVE' AND e.status = 'UNCERTAIN') AS uncertain_jobs,
    (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.verification != 'VERIFIED_ACTIVE') AS unverified_jobs
  FROM companies c`;

export function listCompanies(userId: string): Company[] {
  return all<Record<string, any>>(`${COMPANY_ROLLUP} WHERE c.user_id = ? ORDER BY c.added_at DESC`, [userId]).map(mapCompany);
}

export function getCompany(userId: string, companyId: string): Company | null {
  const row = one<Record<string, any>>(`${COMPANY_ROLLUP} WHERE c.user_id = ? AND c.id = ?`, [userId, companyId]);
  return row ? mapCompany(row) : null;
}

export function findCompanyByName(userId: string, name: string): Company | null {
  const row = one<Record<string, any>>(`${COMPANY_ROLLUP} WHERE c.user_id = ? AND c.normalized_name = ?`, [
    userId,
    normalizeCompanyName(name),
  ]);
  return row ? mapCompany(row) : null;
}

export function createCompany(
  userId: string,
  input: { name: string; officialWebsite?: string | null; careersUrl?: string | null; atsProvider?: string | null; careersUrlSource?: string | null; careersUrlConfidence?: number | null },
): Company {
  const now = nowIso();
  const id = uid();
  const normalized = normalizeCompanyName(input.name);
  const existing = findCompanyByName(userId, input.name);
  if (existing) {
    // Tracking a company twice would double-count its jobs, so update instead.
    if (input.careersUrl && !existing.careersUrl) {
      run(`UPDATE companies SET careers_url = ?, ats_provider = ?, careers_url_source = ?, careers_url_confidence = ?, updated_at = ? WHERE id = ?`, [
        input.careersUrl, input.atsProvider ?? null, input.careersUrlSource ?? null, input.careersUrlConfidence ?? null, now, existing.id,
      ]);
      return getCompany(userId, existing.id)!;
    }
    return existing;
  }
  run(
    `INSERT INTO companies (id, user_id, name, normalized_name, official_website, careers_url, ats_provider,
       careers_url_confidence, careers_url_source, refresh_mode, added_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'MANUAL',?,?,?)`,
    [id, userId, input.name.trim(), normalized, input.officialWebsite ?? null, input.careersUrl ?? null,
      input.atsProvider ?? null, input.careersUrlConfidence ?? null, input.careersUrlSource ?? null, now, now, now],
  );
  run(`INSERT OR IGNORE INTO user_company_watchlist (user_id, company_id, added_at, refresh_mode, pinned) VALUES (?,?,?,'MANUAL',0)`, [
    userId, id, now,
  ]);
  return getCompany(userId, id)!;
}

export function updateCompany(
  userId: string,
  companyId: string,
  patch: { name?: string; officialWebsite?: string | null; careersUrl?: string | null; atsProvider?: string | null; refreshMode?: RefreshMode; pinned?: boolean },
): Company | null {
  const existing = getCompany(userId, companyId);
  if (!existing) return null;
  const now = nowIso();
  run(
    `UPDATE companies SET name = ?, normalized_name = ?, official_website = ?, careers_url = ?, ats_provider = ?,
       refresh_mode = ?, updated_at = ? WHERE id = ?`,
    [
      patch.name?.trim() ?? existing.name,
      patch.name ? normalizeCompanyName(patch.name) : existing.normalizedName,
      patch.officialWebsite !== undefined ? patch.officialWebsite : existing.officialWebsite,
      patch.careersUrl !== undefined ? patch.careersUrl : existing.careersUrl,
      patch.atsProvider !== undefined ? patch.atsProvider : existing.atsProvider,
      patch.refreshMode ?? existing.refreshMode,
      now,
      companyId,
    ],
  );
  if (patch.pinned !== undefined) {
    run(`UPDATE user_company_watchlist SET pinned = ? WHERE user_id = ? AND company_id = ?`, [
      patch.pinned ? 1 : 0, userId, companyId,
    ]);
  }
  return getCompany(userId, companyId);
}

export function deleteCompany(userId: string, companyId: string): boolean {
  return run(`DELETE FROM companies WHERE id = ? AND user_id = ?`, [companyId, userId]).changes > 0;
}

export function markResearched(userId: string, companyId: string, at = nowIso()): void {
  const company = getCompany(userId, companyId);
  const interval =
    company?.refreshMode === 'DAILY' ? 86_400 : company?.refreshMode === 'EVERY_12H' ? 43_200 : company?.refreshMode === 'EVERY_6H' ? 21_600 : null;
  run(`UPDATE companies SET last_researched_at = ?, next_research_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
    at,
    interval ? new Date(Date.parse(at) + interval * 1000).toISOString() : null,
    at,
    companyId,
    userId,
  ]);
}

export function saveCandidates(userId: string, candidates: CompanyCandidate[]): Company[] {
  const saved: Company[] = [];
  for (const c of candidates) {
    saved.push(
      createCompany(userId, {
        name: c.name,
        officialWebsite: c.officialWebsite,
        careersUrl: c.careersUrl,
        atsProvider: c.atsProvider,
        careersUrlSource: c.discoveredVia,
        careersUrlConfidence: c.confidence,
      }),
    );
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function mapJob(row: Record<string, any>): Job {
  return {
    id: row.id,
    companyId: row.company_id,
    externalJobId: str(row.external_job_id),
    title: row.title,
    department: str(row.department),
    category: str(row.category),
    location: str(row.location),
    city: str(row.city),
    country: str(row.country),
    employmentType: str(row.employment_type),
    workArrangement: str(row.work_arrangement),
    postedAt: str(row.posted_at),
    closingAt: str(row.closing_at),
    experienceMin: num(row.experience_min),
    experienceMax: num(row.experience_max),
    educationRequirement: str(row.education_requirement),
    requiredField: str(row.required_field),
    requiredSkills: toArray(row.required_skills),
    preferredSkills: toArray(row.preferred_skills),
    certifications: toArray(row.certifications),
    salary: str(row.salary),
    description: str(row.description),
    responsibilities: toArray(row.responsibilities),
    eligibilityRequirements: toArray(row.eligibility_requirements),
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    isOfficialSource: bool(row.is_official_source),
    alsoSeenAt: toArray(row.also_seen_at),
    status: row.status as JobStatus,
    verification: row.verification as VerificationState,
    dedupeFingerprint: row.dedupe_fingerprint,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: str(row.last_verified_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadCompanyJobs(companyId: string, userId: string, statuses?: JobStatus[]): Record<string, any>[] {
  if (statuses && statuses.length > 0) {
    const placeholders = statuses.map(() => '?').join(',');
    return all<Record<string, any>>(
      `SELECT j.* FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.company_id = ? AND c.user_id = ? AND j.status IN (${placeholders})`,
      [companyId, userId, ...statuses],
    );
  }
  return all<Record<string, any>>(
    `SELECT j.* FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE j.company_id = ? AND c.user_id = ?`,
    [companyId, userId],
  );
}

/** Column names for the job row, in the same order as `jobValues`. */
const JOB_COLUMN_NAMES = [
  'external_job_id', 'title', 'department', 'category', 'location', 'city', 'country',
  'employment_type', 'work_arrangement', 'posted_at', 'closing_at', 'experience_min', 'experience_max',
  'education_requirement', 'required_field', 'required_skills', 'preferred_skills', 'certifications',
  'salary', 'description', 'responsibilities', 'eligibility_requirements', 'requirements',
  'source_url', 'source_name', 'is_official_source', 'also_seen_at', 'status', 'verification',
  'dedupe_fingerprint', 'first_seen_at', 'last_verified_at', 'created_at', 'updated_at',
];

/** `col = ?, col = ?, ...` for an UPDATE ... SET clause. */
const JOB_SET_CLAUSE = JOB_COLUMN_NAMES.map((c) => `${c} = ?`).join(', ');

/** `?, ?, ...` for an INSERT column list of the same length. */
const JOB_PLACEHOLDERS = JOB_COLUMN_NAMES.map(() => '?').join(', ');

function jobValues(job: Record<string, any>): unknown[] {
  const values = [
    job.externalJobId ?? null, job.title, job.department ?? null, job.category ?? null, job.location ?? null,
    job.city ?? null, job.country ?? null, job.employmentType ?? null, job.workArrangement ?? null,
    job.postedAt ?? null, job.closingAt ?? null, job.experienceMin ?? null, job.experienceMax ?? null,
    job.educationRequirement ?? null, job.requiredField ?? null,
    j(job.requiredSkills), j(job.preferredSkills), j(job.certifications), job.salary ?? null,
    job.description ?? null, j(job.responsibilities), j(job.eligibilityRequirements),
    j(job.requirements ?? {}), job.sourceUrl, job.sourceName, job.isOfficialSource ? 1 : 0, j(job.alsoSeenAt),
    job.status, job.verification, job.dedupeFingerprint, job.firstSeenAt, job.lastVerifiedAt ?? null,
    job.createdAt, job.updatedAt,
  ];
  // A silent mismatch here would shift every column and corrupt the row, so it
  // is a programming error and must fail immediately.
  if (values.length !== JOB_COLUMN_NAMES.length) {
    throw new Error(
      `jobValues produced ${values.length} values but there are ${JOB_COLUMN_NAMES.length} job columns.`,
    );
  }
  return values;
}

/**
 * Insert or update one job. `existingId` is supplied when reconciling a job we
 * already track; otherwise the (company_id, dedupe_fingerprint) unique key
 * decides. Returns the job id.
 */
/**
 * Insert or update one job. `existingId` short-circuits the lookup when
 * reconciling a job we already track. Returns the job id, or null when the
 * record is not a real posting (no title) and was therefore not stored.
 */
export function upsertJob(
  companyId: string,
  userId: string,
  job: Record<string, any>,
  fingerprint: string,
  isNew: boolean,
  existingId?: string | null,
): string | null {
  void isNew;
  const now = nowIso();
  const title = typeof job.title === 'string' ? job.title.trim() : '';
  if (!title) return null;

  const record: Record<string, any> = { ...job, title, dedupeFingerprint: fingerprint };

  if (existingId) {
    const owned = one<{ id: string }>(
      `SELECT j.id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ? AND c.user_id = ?`,
      [existingId, userId],
    );
    if (!owned) return null;
    run(`UPDATE jobs SET ${JOB_SET_CLAUSE} WHERE id = ?`, [...jobValues(record), existingId]);
    recordSource(existingId, String(record.sourceUrl), String(record.sourceName), Boolean(record.isOfficialSource), now);
    return existingId;
  }

  const found = one<{ id: string }>(`SELECT id FROM jobs WHERE company_id = ? AND dedupe_fingerprint = ?`, [companyId, fingerprint]);
  if (found) {
    run(`UPDATE jobs SET ${JOB_SET_CLAUSE} WHERE id = ?`, [...jobValues(record), found.id]);
    recordSource(found.id, String(record.sourceUrl), String(record.sourceName), Boolean(record.isOfficialSource), now);
    return found.id;
  }

  const id = uid();
  const first = typeof job.firstSeenAt === 'string' ? job.firstSeenAt : now;
  run(
    `INSERT INTO jobs (id, company_id, ${JOB_COLUMN_NAMES.join(', ')}) VALUES (?,?,${JOB_PLACEHOLDERS})`,
    [id, companyId, ...jobValues({ ...record, firstSeenAt: first, createdAt: job.createdAt ?? now })],
  );
  recordSource(id, String(record.sourceUrl), String(record.sourceName), Boolean(record.isOfficialSource), now);
  return id;
}

function recordSource(jobId: string, url: string, name: string, official: boolean, at: string): void {
  run(
    `INSERT INTO job_sources (id, job_id, source_url, source_name, is_official, first_seen_at, last_seen_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (job_id, source_url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [uid(), jobId, url, name, official ? 1 : 0, at, at],
  );
}

export function applyRemovals(userId: string, removals: Array<Record<string, any>>): string[] {
  const ids: string[] = [];
  for (const r of removals) {
    const changed = run(
      `UPDATE jobs SET status = ?, verification = ?, last_verified_at = ?, updated_at = ?
       WHERE id = ? AND company_id IN (SELECT id FROM companies WHERE user_id = ?)`,
      ['REMOVED', 'LAST_VERIFIED_UNAVAILABLE', nowIso(), nowIso(), r.id, userId],
    );
    if (changed.changes > 0) ids.push(r.id);
  }
  return ids;
}

export function jobSources(jobId: string): Array<{ url: string; name: string; official: boolean; firstSeenAt: string; lastSeenAt: string }> {
  return all<Record<string, any>>(`SELECT source_url, source_name, is_official, first_seen_at, last_seen_at FROM job_sources WHERE job_id = ? ORDER BY is_official DESC, last_seen_at DESC`, [jobId]).map((r) => ({
    url: r.source_url, name: r.source_name, official: bool(r.is_official), firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
  }));
}

// ---------------------------------------------------------------------------
// Requirements + eligibility
// ---------------------------------------------------------------------------

export function saveRequirements(jobId: string, requirements: JobRequirements): void {
  run(`UPDATE jobs SET requirements = ?, required_field = ?, education_requirement = ?,
       experience_min = ?, experience_max = ?, required_skills = ?, preferred_skills = ? WHERE id = ?`, [
    j(requirements), requirements.fields[0] ?? null, requirements.degreeLevelRaw ?? null,
    requirements.experienceMin, requirements.experienceMax,
    j(requirements.skillsRequired), j(requirements.skillsPreferred), jobId,
  ]);
  run(`DELETE FROM job_requirements WHERE job_id = ?`, [jobId]);
  const at = nowIso();
  const add = (type: string, value: string | null, normalized: string | null, mandatory: boolean, origin: string, evidence: string | null): void => {
    run(
      `INSERT OR REPLACE INTO job_requirements (id, job_id, requirement_type, requirement_value, normalized_value, is_mandatory, origin, evidence, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uid(), jobId, type, value, normalized, mandatory ? 1 : 0, origin, evidence, at],
    );
  };
  add('DEGREE', requirements.degreeLevelRaw, requirements.degreeLevel, true, requirements.origin.degreeLevel ?? 'MISSING', requirements.evidence.degreeLevel ?? null);
  for (const f of requirements.fields) add('FIELD', f, f, true, requirements.origin.fields ?? 'MISSING', requirements.evidence.fields ?? null);
  if (requirements.experienceMin !== null) add('EXPERIENCE', requirements.experienceRaw, String(requirements.experienceMin), requirements.experienceMandatory, requirements.origin.experience ?? 'MISSING', requirements.evidence.experience ?? null);
  for (const s of requirements.skillsRequired) add('SKILL', s, slugify(s), true, requirements.origin.skillsRequired ?? 'MISSING', requirements.evidence.skillsRequired ?? null);
  for (const s of requirements.skillsPreferred) add('SKILL', s, slugify(s), false, requirements.origin.skillsPreferred ?? 'MISSING', requirements.evidence.skillsPreferred ?? null);
  for (const c of requirements.certifications) add('CERTIFICATION', c, slugify(c), false, requirements.origin.certifications ?? 'MISSING', requirements.evidence.certifications ?? null);
  for (const l of requirements.locations) add('LOCATION', l, slugify(l), requirements.locationRestricted, requirements.origin.locations ?? 'MISSING', requirements.evidence.locations ?? null);
  for (const w of requirements.workAuthorization ?? []) add('WORK_AUTHORIZATION', w, slugify(w), true, requirements.origin.workAuthorization ?? 'MISSING', requirements.evidence.workAuthorization ?? null);
  for (const g of requirements.gaps) add('GAP', g, slugify(g), false, 'MISSING', null);
}

export function saveEligibility(result: EligibilityResult, requirements: JobRequirements): void {
  run(
    `INSERT INTO eligibility_results (id, job_id, user_id, status, match_score, education_match, experience_match,
       skills_match, location_match, matched_requirements, missing_requirements, concerns, missing_information,
       checks, explanation, engine, analyzed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (job_id, user_id) DO UPDATE SET
       status = excluded.status, match_score = excluded.match_score, education_match = excluded.education_match,
       experience_match = excluded.experience_match, skills_match = excluded.skills_match,
       location_match = excluded.location_match, matched_requirements = excluded.matched_requirements,
       missing_requirements = excluded.missing_requirements, concerns = excluded.concerns,
       missing_information = excluded.missing_information, checks = excluded.checks,
       explanation = excluded.explanation, engine = excluded.engine, analyzed_at = excluded.analyzed_at`,
    [
      uid(), result.jobId, result.userId, result.status, result.matchScore, result.scores.education,
      result.scores.experience, result.scores.skills, result.scores.location,
      j(result.matchedRequirements), j(result.missingRequirements), j(result.concerns), j(result.missingInformation),
      j(result.checks), result.explanation, result.engine, result.analyzedAt,
    ],
  );
  saveRequirements(result.jobId, requirements);
}

export function loadEligibility(jobId: string, userId: string): EligibilityResult | null {
  const row = one<Record<string, any>>(`SELECT * FROM eligibility_results WHERE job_id = ? AND user_id = ?`, [jobId, userId]);
  if (!row) return null;
  return {
    jobId: row.job_id, userId: row.user_id, status: row.status, matchScore: num(row.match_score) ?? 0,
    scores: {
      education: num(row.education_match) ?? 0, experience: num(row.experience_match) ?? 0,
      skills: num(row.skills_match) ?? 0, location: num(row.location_match) ?? 0, other: 0,
    },
    checks: toArray(row.checks), matchedRequirements: toArray(row.matched_requirements),
    missingRequirements: toArray(row.missing_requirements), concerns: toArray(row.concerns),
    missingInformation: toArray(row.missing_information), explanation: row.explanation ?? '',
    engine: row.engine ?? '', analyzedAt: row.analyzed_at,
  };
}

export function loadRequirements(jobId: string): JobRequirements | null {
  const row = one<Record<string, any>>(`SELECT requirements FROM jobs WHERE id = ?`, [jobId]);
  if (!row || !row.requirements) return null;
  const parsed = toObject(row.requirements);
  return Object.keys(parsed).length > 0 ? (parsed as unknown as JobRequirements) : null;
}

// ---------------------------------------------------------------------------
// Job queries
// ---------------------------------------------------------------------------

const POSTED_WINDOW_DAYS: Record<string, number> = {
  TODAY: 1, LAST_3_DAYS: 3, LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30,
};

export interface JobListItem extends Job {
  companyName: string;
  eligibilityStatus: string | null;
  matchScore: number | null;
  missingCount: number;
}

/** Filtered, sorted job list for the dashboard. Only ACTIVE jobs by default. */
export function queryJobs(userId: string, q: JobQuery = {}): { items: JobListItem[]; total: number } {
  const where: string[] = ['c.user_id = ?'];
  const params: unknown[] = [userId];

  if (q.status && q.status !== 'ALL') {
    if (q.status === 'ELIGIBLE' || q.status === 'INELIGIBLE' || q.status === 'UNCERTAIN') {
      where.push(`e.status = ?`);
      params.push(q.status);
    }
  } else {
    where.push(`j.status = 'ACTIVE'`);
  }
  if (q.location) {
    where.push(`j.location LIKE ?`);
    params.push(`%${q.location}%`);
  }
  if (q.department) {
    where.push(`j.department LIKE ?`);
    params.push(`%${q.department}%`);
  }
  if (q.employmentType) {
    where.push(`j.employment_type LIKE ?`);
    params.push(`%${q.employmentType}%`);
  }
  if (q.experience === 'ENTRY') where.push(`(j.experience_min IS NULL OR j.experience_min <= 1)`);
  else if (q.experience === 'MID') where.push(`(j.experience_min > 1 AND j.experience_min <= 4)`);
  else if (q.experience === 'SENIOR') where.push(`(j.experience_min > 4)`);
  if (q.posted && q.posted !== 'ANY') {
    if (q.posted === 'OLDER') {
      where.push(`(j.posted_at IS NULL OR j.posted_at < datetime('now', '-30 days'))`);
    } else {
      where.push(`j.posted_at >= datetime('now', '-${POSTED_WINDOW_DAYS[q.posted] ?? 30} days')`);
    }
  }
  if (q.search) {
    where.push(`(j.title LIKE ? OR j.description LIKE ? OR c.name LIKE ?)`);
    params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }

  const order =
    q.sort === 'OLDEST' ? `j.posted_at IS NULL, j.posted_at ASC`
    : q.sort === 'DEADLINE_SOONEST' ? `j.closing_at IS NULL, j.closing_at ASC`
    : q.sort === 'ELIGIBILITY_FIRST' ? `CASE e.status WHEN 'ELIGIBLE' THEN 0 WHEN 'UNCERTAIN' THEN 1 ELSE 2 END, e.match_score DESC`
    : `j.first_seen_at DESC`;

  const base = `FROM jobs j
    JOIN companies c ON c.id = j.company_id
    LEFT JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
    WHERE ${where.join(' AND ')}`;

  const total = num(one<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, params)?.n) ?? 0;
  const limit = Math.min(q.limit ?? 50, 200);
  const offset = q.offset ?? 0;
  const rows = all<Record<string, any>>(
    `SELECT j.*, c.name AS company_name, e.status AS eligibility_status, e.match_score,
       (SELECT COUNT(*) FROM json_each(j.eligibility_requirements)) AS missing_count
     ${base} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const items: JobListItem[] = rows.map((r) => ({
    ...mapJob(r),
    companyName: r.company_name,
    eligibilityStatus: str(r.eligibility_status),
    matchScore: num(r.match_score),
    missingCount: num(r.missing_count) ?? 0,
  }));
  return { items, total };
}

export function getJob(userId: string, jobId: string): JobListItem | null {
  const row = one<Record<string, any>>(
    `SELECT j.*, c.name AS company_name, e.status AS eligibility_status, e.match_score
     FROM jobs j JOIN companies c ON c.id = j.company_id
     LEFT JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
     WHERE j.id = ? AND c.user_id = ?`,
    [jobId, userId],
  );
  if (!row) return null;
  return {
    ...mapJob(row), companyName: row.company_name,
    eligibilityStatus: str(row.eligibility_status), matchScore: num(row.match_score), missingCount: 0,
  };
}

export function jobFacets(userId: string): { locations: string[]; departments: string[]; employmentTypes: string[] } {
  const col = (c: string): string[] =>
    all<{ v: string }>(
      `SELECT DISTINCT ${c} AS v FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE c.user_id = ? AND j.status = 'ACTIVE' AND ${c} IS NOT NULL AND ${c} <> ''
       ORDER BY v LIMIT 100`,
      [userId],
    ).map((r) => r.v);
  return { locations: col('j.location'), departments: col('j.department'), employmentTypes: col('j.employment_type') };
}

export function dashboardSummary(userId: string, profile: UserProfile | null): DashboardSummary {
  const c = one<Record<string, any>>(
    `SELECT
       (SELECT COUNT(*) FROM companies WHERE user_id = ?) AS companies,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.user_id = ? AND j.status = 'ACTIVE') AS active_jobs,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id
          JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
        WHERE c.user_id = ? AND j.status = 'ACTIVE' AND e.status = 'ELIGIBLE') AS eligible,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id
          JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
        WHERE c.user_id = ? AND j.status = 'ACTIVE' AND e.status = 'INELIGIBLE') AS ineligible,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id
          JOIN eligibility_results e ON e.job_id = j.id AND e.user_id = c.user_id
        WHERE c.user_id = ? AND j.status = 'ACTIVE' AND e.status = 'UNCERTAIN') AS uncertain,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE c.user_id = ? AND j.status = 'ACTIVE' AND date(j.first_seen_at) = date('now')) AS new_today,
       (SELECT COUNT(*) FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE c.user_id = ? AND j.status = 'ACTIVE' AND j.closing_at IS NOT NULL
          AND date(j.closing_at) BETWEEN date('now') AND date('now', '+7 days')) AS closing_soon,
       (SELECT MAX(last_researched_at) FROM companies WHERE user_id = ?) AS last_researched`,
    [userId, userId, userId, userId, userId, userId, userId, userId],
  );
  return {
    companiesTracked: num(c?.companies) ?? 0,
    activeJobs: num(c?.active_jobs) ?? 0,
    eligibleJobs: num(c?.eligible) ?? 0,
    ineligibleJobs: num(c?.ineligible) ?? 0,
    uncertainJobs: num(c?.uncertain) ?? 0,
    newJobsToday: num(c?.new_today) ?? 0,
    jobsClosingSoon: num(c?.closing_soon) ?? 0,
    lastResearchedAt: str(c?.last_researched),
    profileComplete: profileComplete(profile),
  };
}

export function jobsClosingWithin(userId: string, days: number): Array<{ id: string; title: string; companyName: string; closingAt: string; daysLeft: number }> {
  return all<Record<string, any>>(
    `SELECT j.id, j.title, c.name AS company_name, j.closing_at
     FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE c.user_id = ? AND j.status = 'ACTIVE' AND j.closing_at IS NOT NULL
       AND date(j.closing_at) BETWEEN date('now') AND date('now', '+' || ? || ' days')
     ORDER BY j.closing_at ASC LIMIT 100`,
    [userId, days],
  ).map((r) => ({ id: r.id, title: r.title, companyName: r.company_name, closingAt: r.closing_at, daysLeft: daysBetween(nowIso(), r.closing_at) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function insertNotification(n: {
  userId: string; kind: AppNotification['kind']; companyId?: string | null; jobId?: string | null; title: string; body?: string | null;
}): string {
  const id = uid();
  run(
    `INSERT INTO notifications (id, user_id, kind, company_id, job_id, title, body, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, n.userId, n.kind, n.companyId ?? null, n.jobId ?? null, n.title, n.body ?? null, nowIso()],
  );
  return id;
}

export function listNotifications(userId: string, limit = 50): AppNotification[] {
  return all<Record<string, any>>(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]).map((r) => ({
    id: r.id, userId: r.user_id, kind: r.kind, companyId: str(r.company_id), jobId: str(r.job_id),
    title: r.title, body: r.body ?? '', readAt: str(r.read_at), createdAt: r.created_at,
  }));
}

export function markNotificationsRead(userId: string, ids: string[]): number {
  let n = 0;
  for (const id of ids) n += run(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`, [nowIso(), id, userId]).changes;
  return n;
}

export function unreadNotificationCount(userId: string): number {
  return num(one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, [userId])?.n) ?? 0;
}

// ---------------------------------------------------------------------------
// Email preferences
// ---------------------------------------------------------------------------

export function getEmailPrefs(userId: string): EmailPrefs {
  const row = one<Record<string, any>>(`SELECT * FROM email_preferences WHERE user_id = ?`, [userId]);
  if (!row) return { enabled: false, frequency: 'DAILY', email: null };
  return { enabled: bool(row.enabled), frequency: row.frequency, email: str(row.email) };
}

export function setEmailPrefs(userId: string, prefs: EmailPrefs): EmailPrefs {
  run(
    `INSERT INTO email_preferences (user_id, enabled, frequency, email, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, frequency = excluded.frequency,
       email = excluded.email, updated_at = excluded.updated_at`,
    [userId, prefs.enabled ? 1 : 0, prefs.frequency, prefs.email, nowIso()],
  );
  return getEmailPrefs(userId);
}

export function dueForRefresh(now = nowIso()): Company[] {
  return all<Record<string, any>>(
    `${COMPANY_ROLLUP} WHERE c.next_research_at IS NOT NULL AND c.next_research_at <= ?
     ORDER BY c.next_research_at ASC LIMIT 5`,
    [now],
  ).map(mapCompany);
}
