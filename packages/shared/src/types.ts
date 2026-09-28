/**
 * Domain types shared by the API and the web client.
 * Kept dependency-free so it can be imported from anywhere.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Primary eligibility verdict. Exactly one per (job, user). */
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'UNCERTAIN';

/** Per-factor outcome used to build the verdict. */
export type CheckOutcome = 'MATCH' | 'MISMATCH' | 'PARTIAL' | 'UNKNOWN';

export type CheckFactor =
  | 'EDUCATION'
  | 'DEGREE_LEVEL'
  | 'EXPERIENCE'
  | 'GRADUATION_YEAR'
  | 'SKILLS'
  | 'LOCATION'
  | 'WORK_AUTHORIZATION'
  | 'OTHER';

/** Job lifecycle. Only ACTIVE jobs are counted in the primary job count. */
export type JobStatus = 'ACTIVE' | 'EXPIRED' | 'REMOVED' | 'UNKNOWN';

/** How confidently we could confirm the posting is still live. */
export type VerificationState =
  | 'VERIFIED_ACTIVE' // re-fetched this run, posting still present
  | 'LAST_VERIFIED_UNAVAILABLE' // source no longer shows the posting
  | 'UNVERIFIED'; // never successfully verified, or last check failed

export type RefreshMode = 'MANUAL' | 'EVERY_6H' | 'EVERY_12H' | 'DAILY';

export type ResearchRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type DegreeLevel =
  | 'ANY'
  | 'HIGH_SCHOOL'
  | 'DIPLOMA'
  | 'BACHELOR'
  | 'MASTER'
  | 'DOCTORATE'
  | 'UNKNOWN';

/** How a requirement came to exist. MISSING = not stated in the posting. */
export type RequirementOrigin = 'EXPLICIT' | 'INFERRED' | 'LLM' | 'MISSING';

/** Normalized engineering / science field identifiers. */
export type FieldId = string;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface UserProfile {
  userId: string;
  name: string;
  email: string;

  degree: string;
  branch: string;
  college: string | null;
  graduationYear: number;
  cgpa: number | null;
  cgpaScale: number;

  gateScore: number | null;
  gateRank: number | null;
  gateYear: number | null;
  gateBranch: string | null;

  yearsOfExperience: number;
  minDesiredExperience: number;
  maxDesiredExperience: number;

  internships: string;
  certifications: string[];
  skills: string[];

  workAuthorization: string[];
  preferredLocations: string[];
  preferredJobTypes: string[];
  willingToRelocate: boolean;

  updatedAt: string;
}

export type ProfilePatch = Partial<Omit<UserProfile, 'userId' | 'updatedAt'>>;

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface Company {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  officialWebsite: string | null;
  careersUrl: string | null;
  logoUrl: string | null;
  atsProvider: string | null;
  careersUrlConfidence: number | null;
  careersUrlSource: string | null;
  addedAt: string;
  lastResearchedAt: string | null;
  nextResearchAt: string | null;
  refreshMode: RefreshMode;
  /** Rollup counters, computed by the API. */
  activeJobs: number;
  eligibleJobs: number;
  ineligibleJobs: number;
  uncertainJobs: number;
  unverifiedJobs: number;
}

export type CompanyCandidate = {
  name: string;
  officialWebsite: string | null;
  careersUrl: string | null;
  logoUrl: string | null;
  atsProvider: string | null;
  confidence: number;
  discoveredVia: string;
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  companyId: string;
  externalJobId: string | null;
  title: string;
  department: string | null;
  category: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  employmentType: string | null;
  workArrangement: string | null;

  postedAt: string | null;
  closingAt: string | null;

  experienceMin: number | null;
  experienceMax: number | null;
  educationRequirement: string | null;
  requiredField: string | null;
  requiredSkills: string[];
  preferredSkills: string[];
  certifications: string[];
  salary: string | null;

  description: string | null;
  responsibilities: string[];
  eligibilityRequirements: string[];

  sourceUrl: string;
  sourceName: string;
  isOfficialSource: boolean;
  /** All other places this same job was seen (for provenance / dedupe). */
  alsoSeenAt: string[];

  status: JobStatus;
  verification: VerificationState;
  dedupeFingerprint: string;

  firstSeenAt: string;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The structured, normalized view of what a posting actually requires. */
export interface JobRequirements {
  degreeLevel: DegreeLevel;
  degreeLevelRaw: string | null;
  fields: FieldId[];
  fieldsRaw: string;
  /** true when the posting offers equivalents (e.g. "or equivalent"). */
  acceptsEquivalent: boolean;

  experienceMin: number | null;
  experienceMax: number | null;
  experienceStated: boolean;
  /** true when the posting frames the experience requirement as a hard gate. */
  experienceMandatory: boolean;
  experienceRaw: string | null;

  gradYearMin: number | null;
  gradYearMax: number | null;
  gradYearStated: boolean;
  gradYearRaw: string | null;

  skillsRequired: string[];
  skillsPreferred: string[];
  skillsRequiredRaw: string[];
  certifications: string[];

  locations: string[];
  locationRestricted: boolean;
  locationRaw: string | null;
  requiresRelocation: boolean;

  /** null = posting says nothing about work authorization. */
  workAuthorization: string[] | null;

  origin: Record<string, RequirementOrigin>;
  /** Human-readable evidence per factor, quoted from the posting. */
  evidence: Record<string, string>;
  /** Populated when extraction was thin; drives UNCERTAIN rather than a guess. */
  gaps: string[];
}

export type ExtractedJob = Omit<Job, 'id' | 'companyId' | 'status' | 'verification' | 'firstSeenAt' | 'createdAt' | 'updatedAt'> & {
  requirements: JobRequirements;
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface EligibilityCheck {
  factor: CheckFactor;
  label: string;
  outcome: CheckOutcome;
  /** Mandatory factors can drive INELIGIBLE. Advisory ones cannot. */
  mandatory: boolean;
  detail: string;
  evidence?: string | null;
}

export interface MatchBreakdown {
  education: number;
  experience: number;
  skills: number;
  location: number;
  other: number;
}

export interface EligibilityResult {
  jobId: string;
  userId: string;
  status: EligibilityStatus;
  /** Informational only. Mandatory requirements always take priority. */
  matchScore: number;
  scores: MatchBreakdown;
  checks: EligibilityCheck[];
  matchedRequirements: string[];
  missingRequirements: string[];
  concerns: string[];
  missingInformation: string[];
  explanation: string;
  engine: string;
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export type ResearchStepKey =
  | 'RESOLVING_CAREERS_URL'
  | 'SEARCHING_OPENINGS'
  | 'EXTRACTING_POSTINGS'
  | 'CHECKING_DATES'
  | 'VERIFYING_SOURCES'
  | 'ANALYZING_ELIGIBILITY'
  | 'REMOVING_DUPLICATES'
  | 'UPDATING_DASHBOARD';

export interface ResearchStep {
  key: ResearchStepKey;
  label: string;
  state: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ResearchRun {
  id: string;
  companyId: string;
  userId: string;
  status: ResearchRunStatus;
  startedAt: string;
  completedAt: string | null;
  jobsFound: number;
  jobsNew: number;
  jobsUpdated: number;
  jobsRemoved: number;
  eligibleJobs: number;
  sourcesTried: string[];
  sourcesOk: string[];
  errorMessage: string | null;
  steps: ResearchStep[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationKind =
  | 'NEW_ELIGIBLE_JOB'
  | 'ELIGIBLE_JOB_CHANGED'
  | 'DEADLINE_APPROACHING'
  | 'ELIGIBLE_JOB_DISAPPEARED'
  | 'JOB_COUNT_CHANGED'
  | 'RESEARCH_FAILED'
  | 'RESEARCH_COMPLETED';

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  companyId: string | null;
  jobId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Email preferences
// ---------------------------------------------------------------------------

export interface EmailPrefs {
  enabled: boolean;
  frequency: 'IMMEDIATELY' | 'DAILY' | 'WEEKLY';
  email: string | null;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  companiesTracked: number;
  activeJobs: number;
  eligibleJobs: number;
  ineligibleJobs: number;
  uncertainJobs: number;
  newJobsToday: number;
  jobsClosingSoon: number;
  lastResearchedAt: string | null;
  profileComplete: boolean;
}

export type JobSort = 'NEWEST' | 'OLDEST' | 'DEADLINE_SOONEST' | 'ELIGIBILITY_FIRST';
export type PostedWindow = 'ANY' | 'TODAY' | 'LAST_3_DAYS' | 'LAST_7_DAYS' | 'LAST_14_DAYS' | 'LAST_30_DAYS' | 'OLDER';
export type StatusFilter = 'ALL' | 'ELIGIBLE' | 'INELIGIBLE' | 'UNCERTAIN';

export interface JobQuery {
  status?: StatusFilter;
  location?: string;
  department?: string;
  employmentType?: string;
  experience?: string;
  posted?: PostedWindow;
  sort?: JobSort;
  search?: string;
  limit?: number;
  offset?: number;
}
