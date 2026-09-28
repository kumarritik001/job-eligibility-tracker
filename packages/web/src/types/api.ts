/**
 * Response shapes, transcribed from the real Fastify handlers in
 * packages/server/src/routes/api.ts and the repository returns in
 * packages/server/src/services/store.ts.
 *
 * Anything the server computes stays a type here rather than being derived in
 * the UI. The frontend never recalculates eligibility.
 */

import type {
  CheckOutcome,
  Company,
  CompanyCandidate,
  EligibilityCheck,
  EligibilityResult,
  EligibilityStatus,
  EmailPrefs,
  Job,
  JobRequirements,
  JobSort,
  PostedWindow,
  ResearchRun,
  ResearchStep,
  StatusFilter,
  UserProfile,
  DashboardSummary,
  AppNotification,
} from '@jet/shared';

export type {
  CheckOutcome,
  Company,
  CompanyCandidate,
  DashboardSummary,
  EligibilityCheck,
  EligibilityResult,
  EligibilityStatus,
  EmailPrefs,
  Job,
  JobRequirements,
  ResearchRun,
  ResearchStep,
  UserProfile,
  AppNotification,
  JobSort,
  PostedWindow,
  StatusFilter,
};

/** store.JobListItem — a Job plus the rollup fields the list query attaches. */
export interface JobListItem extends Job {
  companyName: string;
  /** Stored as TEXT in SQLite, so it is nullable and not a closed union. */
  eligibilityStatus: string | null;
  matchScore: number | null;
  missingCount: number;
}

/** A company detail job: the list item plus the full per-user analysis. */
export interface CompanyJob extends JobListItem {
  eligibility: EligibilityResult | null;
}

export interface JobSource {
  url: string;
  name: string;
  official: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

// --- Auth -------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  userId: string;
  profile: UserProfile | null;
  profileGaps: string[];
}

// --- Dashboard --------------------------------------------------------------

export interface ClosingSoonJob {
  id: string;
  title: string;
  companyName: string;
  closingAt: string;
  daysLeft: number;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  profileGaps: string[];
  recentJobs: JobListItem[];
  closingSoon: ClosingSoonJob[];
  recentRuns: ResearchRun[];
  capabilities: { searchProvider: string | null; ai: boolean; email: boolean };
}

// --- Companies --------------------------------------------------------------

export interface CompanyListResponse {
  companies: Company[];
}

export interface CompanyCreateResponse {
  company: Company;
  created: boolean;
}

export interface CompanyDetailResponse {
  company: Company;
  jobs: CompanyJob[];
  runs: ResearchRun[];
}

export interface DiscoverResponse {
  candidates: CompanyCandidate[];
  provider: string | null;
}

// --- Research ---------------------------------------------------------------

/** POST /api/companies/:id/research -> 202 */
export interface ResearchStartResponse {
  runId: string;
  status: 'RUNNING';
  /** True when the server joined a run that was already in flight. */
  alreadyRunning: boolean;
}

export interface LiveResearch {
  running: boolean;
  steps: ResearchStep[];
}

export interface ResearchStatusResponse {
  run: ResearchRun | null;
  live: LiveResearch | null;
}

export interface ResearchListResponse {
  runs: ResearchRun[];
}

// --- Jobs -------------------------------------------------------------------

export interface JobFacets {
  locations: string[];
  departments: string[];
  employmentTypes: string[];
}

export interface JobListResponse {
  items: JobListItem[];
  total: number;
  facets: JobFacets;
}

export interface JobDetailResponse {
  job: JobListItem;
  requirements: JobRequirements | null;
  eligibility: EligibilityResult | null;
  sources: JobSource[];
}

export interface JobQueryInput {
  status?: StatusFilter;
  location?: string;
  department?: string;
  employmentType?: string;
  experience?: 'ENTRY' | 'MID' | 'SENIOR';
  posted?: PostedWindow;
  sort?: JobSort;
  search?: string;
  limit?: number;
  offset?: number;
}

// --- Profile / notifications / settings -------------------------------------

export interface ProfileResponse {
  profile: UserProfile | null;
  gaps: string[];
}

export interface NotificationListResponse {
  notifications: AppNotification[];
  unread: number;
}

export interface MarkReadResponse {
  updated: number;
  unread: number;
}

export interface EmailSettingsResponse {
  prefs: EmailPrefs;
  configured: boolean;
}

export interface HealthResponse {
  ok: boolean;
  env: string;
  authMode: string;
  capabilities: {
    searchProvider: string | null;
    ai: string | null;
    email: boolean;
    scheduler: boolean;
  };
}
