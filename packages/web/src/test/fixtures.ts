/**
 * TEST FIXTURES — synthetic data used only by the frontend test suite.
 *
 * These values never appear in application code. The running app renders
 * whatever GET /api/* returns; if the backend is unavailable the UI shows an
 * error or empty state instead of this data.
 */

import type {
  Company,
  CompanyJob,
  CompanyListResponse,
  DashboardResponse,
  EligibilityResult,
  JobListItem,
  NotificationListResponse,
  ResearchStatusResponse,
} from '../types/api';

export const TEST_USER = { id: 'user-1', email: 'ritik@example.com' };
export const TEST_TOKEN = 'test.jwt.token';

export function makeEligibility(overrides: Partial<EligibilityResult> = {}): EligibilityResult {
  return {
    jobId: 'job-1',
    userId: TEST_USER.id,
    status: 'ELIGIBLE',
    matchScore: 92,
    scores: { education: 100, experience: 90, skills: 88, location: 100, other: 70 },
    checks: [
      {
        factor: 'EDUCATION',
        label: 'Chemical Engineering degree',
        outcome: 'MATCH',
        mandatory: true,
        detail: 'Your branch matches the required field exactly.',
        evidence: 'B.Tech in Chemical Engineering',
      },
      {
        factor: 'EXPERIENCE',
        label: 'Experience requirement',
        outcome: 'MATCH',
        mandatory: true,
        detail: 'Your 2 years meets the 1 year minimum.',
      },
      {
        factor: 'SKILLS',
        label: 'Required skills',
        outcome: 'MATCH',
        mandatory: false,
        detail: 'You list 2 of the 2 required skills.',
      },
      {
        factor: 'WORK_AUTHORIZATION',
        label: 'Work authorization',
        outcome: 'UNKNOWN',
        mandatory: false,
        detail: 'The posting does not state a requirement.',
      },
    ],
    matchedRequirements: ['Chemical Engineering degree', 'Experience requirement', 'Required skills'],
    missingRequirements: [],
    concerns: [],
    missingInformation: ['Work authorization not specified'],
    explanation: 'You meet every mandatory requirement the posting states.',
    engine: 'deterministic-rule-engine@1',
    analyzedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

export function makeJob(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    companyId: 'company-1',
    externalJobId: 'EXT-1',
    title: 'Process Engineer',
    department: 'Engineering',
    category: 'Engineering',
    location: 'Bengaluru, India',
    city: 'Bengaluru',
    country: 'India',
    employmentType: 'Full time',
    workArrangement: 'On-site',
    postedAt: '2026-09-18T09:00:00.000Z',
    closingAt: '2026-10-10T17:00:00.000Z',
    experienceMin: 1,
    experienceMax: 3,
    educationRequirement: 'B.Tech in Chemical Engineering',
    requiredField: 'chemical-engineering',
    requiredSkills: ['Aspen Plus', 'MATLAB'],
    preferredSkills: ['Process simulation'],
    certifications: [],
    salary: null,
    description: 'We are hiring a process engineer to support our refining operations.',
    responsibilities: ['Own unit operations analysis.', 'Support scale-up studies.'],
    eligibilityRequirements: ['Must be authorised to work in India.'],
    sourceUrl: 'https://careers.example.com/jobs/1',
    sourceName: 'Example Careers',
    isOfficialSource: true,
    alsoSeenAt: [],
    status: 'ACTIVE',
    verification: 'VERIFIED_ACTIVE',
    dedupeFingerprint: 'fp-1',
    firstSeenAt: '2026-09-18T09:00:00.000Z',
    lastVerifiedAt: '2026-09-20T08:00:00.000Z',
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    companyName: 'ExxonMobil',
    eligibilityStatus: 'ELIGIBLE',
    matchScore: 92,
    missingCount: 0,
    ...overrides,
  };
}

export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    userId: TEST_USER.id,
    name: 'ExxonMobil',
    normalizedName: 'exxonmobil',
    officialWebsite: 'https://corporate.exxonmobil.com',
    careersUrl: 'https://careers.exxonmobil.com',
    logoUrl: null,
    atsProvider: 'workday',
    careersUrlConfidence: 1,
    careersUrlSource: 'user provided',
    addedAt: '2026-09-01T09:00:00.000Z',
    lastResearchedAt: '2026-09-20T08:00:00.000Z',
    nextResearchAt: null,
    refreshMode: 'MANUAL',
    activeJobs: 42,
    eligibleJobs: 7,
    ineligibleJobs: 20,
    uncertainJobs: 15,
    unverifiedJobs: 0,
    ...overrides,
  };
}

export function makeCompanyJob(overrides: Partial<CompanyJob> = {}): CompanyJob {
  return { ...makeJob(), eligibility: makeEligibility(), ...overrides };
}

export const eligibleJob = makeJob({ id: 'job-eligible', title: 'Process Engineer', eligibilityStatus: 'ELIGIBLE' });

export const ineligibleJob = makeJob({
  id: 'job-ineligible',
  title: 'Senior Process Safety Lead',
  eligibilityStatus: 'INELIGIBLE',
  matchScore: 20,
  experienceMin: 8,
  experienceMax: 12,
  missingCount: 1,
});

export const uncertainJob = makeJob({
  id: 'job-uncertain',
  title: 'Graduate Process Engineer',
  eligibilityStatus: 'UNCERTAIN',
  matchScore: 55,
  missingCount: 2,
});

export const ineligibleEligibility = makeEligibility({
  jobId: 'job-ineligible',
  status: 'INELIGIBLE',
  matchScore: 20,
  explanation: 'You do not meet the mandatory experience requirement.',
  matchedRequirements: ['Chemical Engineering degree'],
  missingRequirements: ['3+ years required'],
  checks: [
    {
      factor: 'EDUCATION',
      label: 'Chemical Engineering degree',
      outcome: 'MATCH',
      mandatory: true,
      detail: 'Your branch matches the required field exactly.',
    },
    {
      factor: 'EXPERIENCE',
      label: '3+ years required',
      outcome: 'MISMATCH',
      mandatory: true,
      detail: 'The posting needs 3 years minimum; you have 2.',
    },
  ],
});

export const uncertainEligibility = makeEligibility({
  jobId: 'job-uncertain',
  status: 'UNCERTAIN',
  matchScore: 55,
  explanation: 'A required detail is missing from the posting, so we cannot decide.',
  missingInformation: ['Work authorization not specified'],
  checks: [
    {
      factor: 'WORK_AUTHORIZATION',
      label: 'Work authorization not specified',
      outcome: 'UNKNOWN',
      mandatory: true,
      detail: 'The posting does not say who may apply.',
    },
  ],
});

export const dashboardFixture: DashboardResponse = {
  summary: {
    companiesTracked: 3,
    activeJobs: 60,
    eligibleJobs: 12,
    ineligibleJobs: 30,
    uncertainJobs: 18,
    newJobsToday: 4,
    jobsClosingSoon: 2,
    lastResearchedAt: '2026-09-20T08:00:00.000Z',
    profileComplete: true,
  },
  profileGaps: [],
  // Two distinct rows: repeating one object here produced duplicate React keys
  // and buried the warning that would matter.
  recentJobs: [
    eligibleJob,
    makeJob({ id: 'job-recent-2', title: 'Process Engineer II', companyId: 'company-2', companyName: 'Shell', eligibilityStatus: 'UNCERTAIN' }),
  ],
  closingSoon: [
    { id: 'job-eligible', title: 'Process Engineer', companyName: 'ExxonMobil', closingAt: '2026-10-10T17:00:00.000Z', daysLeft: 3 },
  ],
  recentRuns: [
    {
      id: 'run-1',
      companyId: 'company-1',
      userId: TEST_USER.id,
      status: 'COMPLETED',
      startedAt: '2026-09-20T07:50:00.000Z',
      completedAt: '2026-09-20T08:00:00.000Z',
      jobsFound: 42,
      jobsNew: 5,
      jobsUpdated: 37,
      jobsRemoved: 2,
      eligibleJobs: 7,
      sourcesTried: ['workday'],
      sourcesOk: ['workday'],
      errorMessage: null,
      steps: [
        { key: 'RESOLVING_CAREERS_URL', label: 'Resolving careers URL', state: 'done' },
        { key: 'SEARCHING_OPENINGS', label: 'Searching openings', state: 'done' },
        { key: 'ANALYZING_ELIGIBILITY', label: 'Analysing eligibility', state: 'done' },
      ],
    },
  ],
  capabilities: { searchProvider: 'serper', ai: false, email: false },
};

export const companiesFixture: CompanyListResponse = {
  companies: [makeCompany(), makeCompany({ id: 'company-2', name: 'Reliance Industries', eligibleJobs: 3, activeJobs: 18, uncertainJobs: 5, ineligibleJobs: 10 })],
};

export const notificationsFixture: NotificationListResponse = {
  notifications: [
    {
      id: 'note-1',
      userId: TEST_USER.id,
      kind: 'NEW_ELIGIBLE_JOB',
      companyId: 'company-1',
      jobId: 'job-eligible',
      title: 'New eligible job',
      body: 'Process Engineer at ExxonMobil matches your profile.',
      readAt: null,
      createdAt: '2026-09-20T08:05:00.000Z',
    },
  ],
  unread: 1,
};

export const researchStatusFixture: ResearchStatusResponse = {
  run: null,
  live: {
    running: true,
    steps: [
      { key: 'RESOLVING_CAREERS_URL', label: 'Resolving careers URL', state: 'done' },
      { key: 'SEARCHING_OPENINGS', label: 'Searching openings', state: 'running' },
      { key: 'ANALYZING_ELIGIBILITY', label: 'Analysing eligibility', state: 'pending' },
    ],
  },
};
