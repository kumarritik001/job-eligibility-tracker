/**
 * Unit tests for the shared engine.
 *
 * These are the guarantees the product actually promises, so they are asserted
 * rather than assumed: precedence, "no data is never eligible", duplicate
 * handling, and lifecycle preservation on a failed refresh.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeEligibility,
  decide,
  extractRequirements,
  fingerprintFor,
  isDuplicate,
  reconcile,
  type Job,
  type JobRequirements,
  type UserProfile,
} from '@jet/shared';

const profile: UserProfile = {
  userId: 'u1',
  name: 'Test',
  email: 't@example.com',
  degree: 'B.Tech',
  branch: 'Chemical Engineering',
  college: null,
  graduationYear: 2026,
  cgpa: 8.5,
  cgpaScale: 10,
  gateScore: null,
  gateRank: 508,
  gateYear: 2026,
  gateBranch: 'Chemical Engineering',
  yearsOfExperience: 0,
  minDesiredExperience: 0,
  maxDesiredExperience: 2,
  internships: '',
  certifications: [],
  skills: ['Python', 'SQL'],
  workAuthorization: [],
  preferredLocations: ['Pune'],
  preferredJobTypes: ['Full Time'],
  willingToRelocate: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    companyId: 'c1',
    externalJobId: 'e1',
    title: 'Process Engineer',
    department: null,
    category: null,
    location: 'Pune, India',
    city: 'Pune',
    country: 'India',
    employmentType: 'Full Time',
    workArrangement: null,
    postedAt: '2026-01-01T00:00:00.000Z',
    closingAt: null,
    experienceMin: null,
    experienceMax: null,
    educationRequirement: null,
    requiredField: null,
    requiredSkills: [],
    preferredSkills: [],
    certifications: [],
    salary: null,
    description: 'A long enough description to be considered readable by the engine when tests need it to pass the readability gate.',
    responsibilities: [],
    eligibilityRequirements: [],
    sourceUrl: 'https://example.com/jobs/1',
    sourceName: 'Example careers',
    isOfficialSource: true,
    alsoSeenAt: [],
    status: 'ACTIVE',
    verification: 'VERIFIED_ACTIVE',
    dedupeFingerprint: 'eid:c1:e1',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const emptyReq: JobRequirements = {
  degreeLevel: 'UNKNOWN',
  degreeLevelRaw: null,
  fields: [],
  fieldsRaw: '',
  acceptsEquivalent: false,
  experienceMin: null,
  experienceMax: null,
  experienceStated: false,
  experienceMandatory: false,
  experienceRaw: null,
  gradYearMin: null,
  gradYearMax: null,
  gradYearStated: false,
  gradYearRaw: null,
  skillsRequired: [],
  skillsPreferred: [],
  skillsRequiredRaw: [],
  certifications: [],
  locations: [],
  locationRestricted: false,
  locationRaw: null,
  requiresRelocation: false,
  workAuthorization: null,
  origin: {},
  evidence: {},
  gaps: [],
};

test('decide() gives INELIGIBLE top priority, then UNCERTAIN, then ELIGIBLE', () => {
  const check = (outcome: string, mandatory: boolean) => ({ outcome, mandatory }) as never;
  assert.equal(decide([check('MISMATCH', true), check('UNKNOWN', true), check('MATCH', true)]), 'INELIGIBLE');
  assert.equal(decide([check('UNKNOWN', true), check('MATCH', true)]), 'UNCERTAIN');
  assert.equal(decide([check('MATCH', true), check('PARTIAL', false)]), 'ELIGIBLE');
  // An advisory mismatch (e.g. a location preference) must not disqualify.
  assert.equal(decide([check('MISMATCH', false), check('MATCH', true)]), 'ELIGIBLE');
});

test('an unreadable posting is UNCERTAIN, never ELIGIBLE', () => {
  const j = job({ description: null, status: 'ACTIVE' });
  const result = analyzeEligibility(j, profile, { ...emptyReq, gaps: ['No description could be read'] });
  assert.equal(result.status, 'UNCERTAIN');
  assert.ok(result.missingInformation.length > 0);
});

test('a mandatory mismatch makes a job ineligible even with a high match score', () => {
  const j = job({ title: 'Senior Process Engineer' });
  const req = extractRequirements({
    title: j.title,
    description: 'Bachelor of Technology in Chemical Engineering or equivalent is required. 5+ years of process experience required in industrial plants.',
    experienceMin: 5,
  });
  const result = analyzeEligibility(j, profile, req);
  assert.equal(result.status, 'INELIGIBLE');
  assert.ok(
    result.checks.some((c) => c.mandatory && c.outcome === 'MISMATCH'),
    'expected a mandatory check to fail',
  );
});

test('a matching degree and no experience gate is ELIGIBLE', () => {
  const j = job({ title: 'Graduate Process Engineer' });
  const req = extractRequirements({
    title: j.title,
    description:
      'Requirements: Bachelor of Technology in Chemical Engineering. Good understanding of mass transfer and process safety. Freshers are welcome and encouraged to apply for this graduate role.',
  });
  const result = analyzeEligibility(j, profile, req);
  assert.equal(result.status, 'ELIGIBLE');
  assert.ok(result.matchScore >= 50);
});

test('extraction records gaps instead of inventing requirements', () => {
  const req = extractRequirements({ title: 'Process Engineer', description: 'Join our team.' });
  assert.equal(req.experienceStated, false);
  assert.equal(req.degreeLevel, 'UNKNOWN');
  assert.ok(req.gaps.length > 0, 'expected at least one recorded gap');
});

test('extraction prefers explicit ATS fields over prose', () => {
  const req = extractRequirements({
    title: 'Chemical Process Engineer',
    description: 'Candidates should have a bachelor degree in any engineering discipline and 1 year of experience.',
    educationRequirement: 'B.Tech in Chemical Engineering',
    experienceMin: 0,
  });
  assert.equal(req.fieldsRaw.includes('Chemical Engineering'), true);
});

test('the same external job id is always a duplicate', () => {
  // Case and punctuation differ between mirrors of the same posting.
  const a = job({ id: 'a', externalJobId: 'X-1' });
  const b = job({ id: 'b', externalJobId: 'x-1' });
  const d = isDuplicate(a, b);
  assert.equal(d.duplicate, true);
  assert.equal(d.confidence, 1);
});

test('identical title and location is a duplicate', () => {
  const a = job({ id: 'a', externalJobId: null, title: 'Process Engineer' });
  const b = job({ id: 'b', externalJobId: null, title: 'process engineer' });
  assert.equal(isDuplicate(a, b).duplicate, true);
});

test('different titles at the same company are kept separate', () => {
  const a = job({ id: 'a', externalJobId: null, title: 'Process Engineer' });
  const b = job({ id: 'b', externalJobId: null, title: 'Quality Control Analyst' });
  assert.equal(isDuplicate(a, b).duplicate, false);
});

test('fingerprint is stable for jobs without an external id', () => {
  const a = fingerprintFor({ companyId: 'c1', externalJobId: null, title: 'Process Engineer', location: 'Pune, India' });
  const b = fingerprintFor({ companyId: 'c1', externalJobId: null, title: 'Process  Engineer ', location: 'pune india' });
  assert.equal(a, b);
});

test('a job seen again is kept ACTIVE and re-verified', () => {
  const existing = [job()];
  const out = reconcile(
    existing,
    [{ fingerprint: 'eid:c1:e1', job: { ...job(), id: undefined } as never }],
    { sourceVerified: true, sourceUrlFor: () => null },
  );
  assert.equal(out.upserts[0].isNew, false);
  assert.equal(out.upserts[0].job.status, 'ACTIVE');
  assert.equal(out.removals.length, 0);
});

test('a missing job is REMOVED only when the source verified successfully', () => {
  const existing = [job()];
  const out = reconcile(existing, [], { sourceVerified: true, sourceUrlFor: () => null });
  assert.equal(out.removals.length, 1);
  assert.equal(out.removals[0].status, 'REMOVED');
  assert.equal(out.removals[0].verification, 'LAST_VERIFIED_UNAVAILABLE');
});

test('a failed fetch leaves previously stored jobs untouched', () => {
  const existing = [job()];
  const out = reconcile(existing, [], { sourceVerified: false, sourceUrlFor: () => null });
  assert.equal(out.removals.length, 0, 'a failed refresh must not remove anything');
  assert.equal(out.upserts.length, 0);
});

test('an already-closed job is not resurrected by a stale listing', () => {
  const existing = [job({ status: 'EXPIRED' })];
  const out = reconcile(
    existing,
    [{ fingerprint: 'eid:c1:e1', job: { ...job(), id: undefined } as never }],
    { sourceVerified: true, sourceUrlFor: () => null },
  );
  assert.equal(out.upserts[0].job.status, 'EXPIRED');
});

test('a closing date in the past makes a new job EXPIRED, not ACTIVE', () => {
  const out = reconcile(
    [],
    [{ fingerprint: 'eid:c1:e2', job: { ...job({ id: undefined, externalJobId: 'e2', closingAt: '2020-01-01' }), id: undefined } as never }],
    { sourceVerified: true, sourceUrlFor: () => null },
  );
  assert.equal(out.upserts[0].job.status, 'EXPIRED');
});

test('location alone never makes a job ineligible', () => {
  const j = job({ location: 'Singapore', title: 'Graduate Process Engineer' });
  const req = extractRequirements({
    title: j.title,
    description: 'Bachelor of Technology in Chemical Engineering. No prior experience needed.',
    location: 'Singapore',
  });
  const result = analyzeEligibility(j, profile, req);
  assert.notEqual(result.status, 'INELIGIBLE');
});

test('a duty sentence does not become a hard skill requirement', () => {
  // Regression: "you will support distillation" describes the work, not a
  // requirement. Treating it as one made genuinely eligible fresher roles
  // return UNCERTAIN, and it also misrepresented the posting to the user.
  const req = extractRequirements({
    title: 'Graduate Process Engineer',
    description:
      'Requirements: Bachelor of Technology in Chemical Engineering. Freshers are welcome. You will support unit operations including distillation and mass transfer.',
  });
  assert.deepEqual(req.skillsRequired, []);
  assert.deepEqual(req.skillsPreferred, []);
});

test('a named branch wins over the generic degree family it sits in', () => {
  // Regression: "Bachelor of Technology" is a longer alias than "Chemical
  // Engineering", so greedy matching classified this as a generic requirement
  // and reported the posting's real field as unspecific.
  const req = extractRequirements({
    title: 'Process Engineer',
    description: 'Bachelor of Technology in Chemical Engineering is required.',
  });
  assert.deepEqual(req.fields, ['CHEMICAL_ENGINEERING']);
});

test('an explicit skill requirement is still captured', () => {
  const req = extractRequirements({
    title: 'Process Engineer',
    description: 'Requirements: Experience in distillation and heat transfer. Familiarity with Aspen Plus is preferred.',
  });
  assert.ok(req.skillsRequired.length > 0, 'an explicit requirement must not be dropped');
  assert.deepEqual(req.skillsRequiredRaw.length > 0, true, 'the evidence quote must be kept');
});

test('the analysis always names its engine and includes an explanation', () => {
  const result = analyzeEligibility(job(), profile, emptyReq);
  assert.ok(result.engine.length > 0);
  assert.ok(result.explanation.length > 0);
  assert.ok(result.analyzedAt.length > 0);
});
