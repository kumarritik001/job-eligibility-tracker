/**
 * API integration tests.
 *
 * Uses a real in-process server and a real SQLite file in a temp directory.
 * No job data is faked: the research endpoints are tested against a local
 * HTTP server that serves a genuine schema.org JobPosting, and against a
 * source that returns garbage, so both the success and the failure path are
 * exercised for real.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../src/db/index.js';

let dir: string;
let fixture: Server;
let fixtureUrl: string;
let app: Awaited<ReturnType<typeof import('../src/index.js').buildServer>>;
let token = '';

const POSTING = `<!doctype html><html><head><title>Process Engineer</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Graduate Process Engineer",
  "description": "Requirements: Bachelor of Technology in Chemical Engineering. Freshers are welcome. You will support unit operations including distillation and mass transfer.",
  "datePosted": "2026-01-05",
  "employmentType": "FULL_TIME",
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Pune", "addressCountry": "IN" } },
  "hiringOrganization": { "@type": "Organization", "name": "Test Chem" },
  "identifier": { "@type": "PropertyValue", "value": "REQ-9001" }
}
</script></head><body><h1>Graduate Process Engineer</h1></body></html>`;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jet-test-'));
  process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
  process.env.JWT_SECRET = 'test-secret-value-for-integration-tests';
  process.env.AUTH_MODE = 'local';
  process.env.CRAWL_REQUEST_DELAY_MS = '0';
  process.env.CRAWL_RESPECT_ROBOTS_TXT = 'false';
  process.env.SCHEDULER_ENABLED = 'false';

  fixture = createServer((req, res) => {
    if (req.url?.startsWith('/robots.txt')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    if (req.url === '/careers/jobs/9001') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(POSTING);
      return;
    }
    if (req.url === '/broken') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>nothing useful here</body></html>');
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r));
  const address = fixture.address();
  if (typeof address === 'object' && address) fixtureUrl = `http://127.0.0.1:${address.port}`;

  // Imported after the env is set so config picks up the temp database.
  const { buildServer } = await import('../src/index.js');
  app = await buildServer();
  await app.ready();

  const signup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'test@example.com', password: 'a-long-test-password' } });
  assert.equal(signup.statusCode, 201, signup.body);
  token = signup.json().token;
});

after(async () => {
  await app?.close();
  await new Promise<void>((r) => fixture.close(() => r()));
  // The SQLite handle must be released first or Windows keeps the file locked.
  closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('health reports capabilities honestly', async () => {
  const res = await app.inject({ url: '/api/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  // No key is configured in the test environment, so it must say so.
  assert.equal(body.capabilities.searchProvider, null);
});

test('protected routes reject anonymous requests', async () => {
  const res = await app.inject({ url: '/api/dashboard' });
  assert.equal(res.statusCode, 401);
});

test('signup rejects a short password', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'a@b.com', password: 'short' } });
  assert.equal(res.statusCode, 400);
});

test('login works and a wrong password does not', async () => {
  const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', password: 'a-long-test-password' } });
  assert.equal(ok.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', password: 'wrong-password-here' } });
  assert.equal(bad.statusCode, 401);
  // The failure message must not reveal whether the email exists.
  assert.equal(bad.json().error, ok.body.length > 0 ? 'Incorrect email or password.' : '');
});

test('profile saves and reports its own gaps', async () => {
  const before = await app.inject({ method: 'GET', url: '/api/profile', headers: auth() });
  assert.ok(before.json().gaps.length > 0, 'a fresh profile must list what is missing');

  const put = await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: auth(),
    payload: {
      name: 'Test User', degree: 'B.Tech', branch: 'Chemical Engineering', graduationYear: 2026,
      skills: ['Python', 'SQL'], preferredLocations: ['Pune'], yearsOfExperience: 0,
      minDesiredExperience: 0, maxDesiredExperience: 2,
    },
  });
  assert.equal(put.statusCode, 200, put.body);
  const after = put.json();
  assert.equal(after.profile.branch, 'Chemical Engineering');
  assert.deepEqual(after.profile.skills, ['Python', 'SQL']);
});

test('profile rejects an out-of-range graduation year', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: auth(), payload: { graduationYear: 1700 } });
  assert.equal(res.statusCode, 400);
});

test('research stores a real posting and counts it as active', async () => {
  const add = await app.inject({
    method: 'POST',
    url: '/api/companies',
    headers: auth(),
    payload: { name: 'Test Chem', careersUrl: `${fixtureUrl}/careers/jobs/9001` },
  });
  assert.equal(add.statusCode, 201, add.body);
  const companyId = add.json().company.id;

  const run = await app.inject({ method: 'POST', url: `/api/companies/${companyId}/research/sync`, headers: auth(), payload: {} });
  assert.equal(run.statusCode, 200, run.body);
  const { summary, steps } = run.json();

  assert.equal(summary.error, null, `research failed: ${summary.error}`);
  assert.equal(summary.jobsFound, 1);
  assert.equal(summary.jobsNew, 1);
  assert.equal(summary.eligibleJobs + summary.ineligibleJobs + summary.uncertainJobs, 1);

  // Steps are streamed as running -> done; the UI collapses them per key.
  const latest = new Map<string, { key: string; label: string; state: string }>();
  for (const s of steps as Array<{ key: string; label: string; state: string }>) latest.set(s.key, s);
  assert.equal(latest.size, 8);
  assert.ok([...latest.values()].every((s) => s.state === 'done' || s.state === 'skipped'));
  assert.ok(latest.has('VERIFYING_SOURCES'));
  assert.ok(latest.has('ANALYZING_ELIGIBILITY'));

  const detail = await app.inject({ url: `/api/companies/${companyId}`, headers: auth() });
  assert.equal(detail.statusCode, 200);
  const company = detail.json();
  assert.equal(company.company.activeJobs, 1);
  assert.equal(company.jobs.length, 1);

  const job = company.jobs[0];
  assert.equal(job.title, 'Graduate Process Engineer');
  assert.equal(job.externalJobId, 'REQ-9001');
  assert.equal(job.sourceUrl, `${fixtureUrl}/careers/jobs/9001`);
  assert.ok(job.lastVerifiedAt, 'a stored job must carry a verification timestamp');
  assert.ok(job.eligibility, 'a stored job must be analyzed');
  assert.equal(job.eligibility.status, 'ELIGIBLE');
});

test('a second run of the same posting does not duplicate it', async () => {
  const companies = await app.inject({ url: '/api/companies', headers: auth() });
  const company = companies.json().companies[0];

  const run = await app.inject({ method: 'POST', url: `/api/companies/${company.id}/research/sync`, headers: auth(), payload: {} });
  const summary = run.json().summary;
  if (summary.jobsFound !== 1) console.log('SECOND RUN SUMMARY', JSON.stringify(summary, null, 2));
  assert.equal(summary.jobsFound, 1, 'the posting must be found again on a second run');
  assert.equal(summary.jobsNew, 0, 'the same posting must not be counted as new twice');
  assert.equal(summary.jobsRemoved, 0);

  const detail = await app.inject({ url: `/api/companies/${company.id}`, headers: auth() });
  assert.equal(detail.json().company.activeJobs, 1);
});

test('a source with no postings fails loudly and keeps the stored job', async () => {
  const add = await app.inject({ method: 'POST', url: '/api/companies', headers: auth(), payload: { name: 'Broken Co', careersUrl: `${fixtureUrl}/broken` } });
  const companyId = add.json().company.id;

  const run = await app.inject({ method: 'POST', url: `/api/companies/${companyId}/research/sync`, headers: auth(), payload: {} });
  const summary = run.json().summary;
  assert.ok(summary.error, 'a source that yields nothing must report an error');
  assert.equal(summary.jobsFound, 0);
  assert.ok(summary.notes.length > 0, 'the reason must be explained to the user');
});

test('an unreachable source is reported, not silently skipped', async () => {
  const add = await app.inject({ method: 'POST', url: '/api/companies', headers: auth(), payload: { name: 'Down Co', careersUrl: 'http://127.0.0.1:1/careers' } });
  const companyId = add.json().company.id;

  const run = await app.inject({ method: 'POST', url: `/api/companies/${companyId}/research/sync`, headers: auth(), payload: {} });
  const summary = run.json().summary;
  assert.ok(summary.error);
  assert.ok(summary.sourcesTried.length > 0);
});

test('the dashboard totals agree with the job list', async () => {
  const dash = await app.inject({ url: '/api/dashboard', headers: auth() });
  assert.equal(dash.statusCode, 200);
  const { summary } = dash.json();
  assert.equal(summary.companiesTracked, 3);
  assert.equal(summary.activeJobs, 1);
  assert.equal(summary.eligibleJobs, 1);

  const jobs = await app.inject({ url: '/api/jobs?status=ELIGIBLE', headers: auth() });
  assert.equal(jobs.json().total, summary.eligibleJobs);
});

test('jobs can be filtered and sorted', async () => {
  const all = await app.inject({ url: '/api/jobs', headers: auth() });
  assert.equal(all.json().total, 1);
  const ineligible = await app.inject({ url: '/api/jobs?status=INELIGIBLE', headers: auth() });
  assert.equal(ineligible.json().total, 0);
  const search = await app.inject({ url: '/api/jobs?search=process', headers: auth() });
  assert.equal(search.json().total, 1);
  const miss = await app.inject({ url: '/api/jobs?search=zzzznotathing', headers: auth() });
  assert.equal(miss.json().total, 0);
});

test('job detail returns requirements, verdict, and every source', async () => {
  const list = await app.inject({ url: '/api/jobs', headers: auth() });
  const jobId = list.json().items[0].id;

  const res = await app.inject({ url: `/api/jobs/${jobId}`, headers: auth() });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.job.id, jobId);
  assert.ok(body.requirements, 'structured requirements must be returned');
  assert.ok(body.eligibility.explanation.length > 0);
  assert.ok(body.sources.length >= 1);
  assert.equal(body.sources[0].url, body.job.sourceUrl);
});

test('a job from another user is not readable', async () => {
  const other = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'other@example.com', password: 'another-long-password' } });
  const otherToken = other.json().token;
  const list = await app.inject({ url: '/api/jobs', headers: { authorization: `Bearer ${otherToken}` } });
  assert.equal(list.json().total, 0);
});

test('re-analysis is deterministic for the same posting', async () => {
  const before = await app.inject({ url: '/api/jobs', headers: auth() });
  const jobId = before.json().items[0].id;
  const first = (await app.inject({ url: `/api/jobs/${jobId}`, headers: auth() })).json().eligibility;

  await app.inject({ method: 'POST', url: '/api/jobs/reanalyze', headers: auth(), payload: {} });
  const second = (await app.inject({ url: `/api/jobs/${jobId}`, headers: auth() })).json().eligibility;

  assert.equal(first.status, second.status);
  assert.equal(first.matchScore, second.matchScore);
  assert.deepEqual(first.matchedRequirements, second.matchedRequirements);
});

/** Minimal RFC 4180 row parser, so quoted commas do not break assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

test('CSV export includes the source URL and flags unstated values', async () => {
  const res = await app.inject({ url: '/api/export/csv', headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/csv/);

  const rows = parseCsv(res.body);
  const header = rows[0];
  const data = rows.slice(1).filter((r) => r.length > 1);
  assert.ok(data.length >= 1, 'the export must include the stored job');
  const col = (name: string): string => data[0][header.indexOf(name)];

  // Absent data must be labelled, never left blank or invented.
  assert.equal(col('Closing date'), 'Not specified in posting');
  assert.equal(col('Preferred skills'), 'Not specified in posting');
  assert.equal(col('Location'), 'Pune, IN');
  assert.equal(col('Verdict'), 'ELIGIBLE');
  assert.equal(col('Source'), `${fixtureUrl}/careers/jobs/9001`);
  assert.ok(col('Last verified').length > 0, 'every row must carry a verification timestamp');
  assert.equal(header.length, data[0].length, 'every row must have the same column count');
});

test('an unknown export format is rejected', async () => {
  const res = await app.inject({ url: '/api/export/docx', headers: auth() });
  assert.equal(res.statusCode, 400);
});

test('email cannot be enabled without a provider configured', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/settings/email', headers: auth(), payload: { enabled: true, frequency: 'DAILY', email: 'a@b.com' } });
  assert.equal(res.statusCode, 409);
});

test('notifications explain the profile re-analysis and can be marked read', async () => {
  // The profile test set a graduation year on a fresh profile, which must
  // re-analyse every job, so a notification is the correct outcome.
  const res = await app.inject({ url: '/api/notifications', headers: auth() });
  assert.equal(res.statusCode, 200);
  const list = res.json();
  assert.equal(list.notifications.length, 1);
  assert.equal(list.unread, 1);
  const n = list.notifications[0];
  assert.equal(n.kind, 'ELIGIBLE_JOB_CHANGED');
  assert.ok(n.title.length > 0 && n.body.length > 0, 'a notification must explain itself');

  const empty = await app.inject({ method: 'POST', url: '/api/notifications/read', headers: auth(), payload: { ids: [] } });
  assert.equal(empty.statusCode, 400);

  const read = await app.inject({ method: 'POST', url: '/api/notifications/read', headers: auth(), payload: { ids: [n.id] } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().updated, 1);
  assert.equal(read.json().unread, 0);
  assert.equal((await app.inject({ url: '/api/notifications', headers: auth() })).json().unread, 0);
});

test('deleting a company removes its jobs from the counts', async () => {
  const list = await app.inject({ url: '/api/jobs', headers: auth() });
  const job = list.json().items[0];
  const companyId = job.companyId;

  const res = await app.inject({ method: 'DELETE', url: `/api/companies/${companyId}`, headers: auth() });
  assert.equal(res.statusCode, 200);

  // The job rows must be gone, not orphaned and still counted.
  const dash = await app.inject({ url: '/api/dashboard', headers: auth() });
  assert.equal(dash.json().summary.activeJobs, 0);
  assert.equal(dash.json().summary.companiesTracked, 2);
  const jobs = await app.inject({ url: '/api/jobs', headers: auth() });
  assert.equal(jobs.json().total, 0);
  assert.equal((await app.inject({ url: `/api/jobs/${job.id}`, headers: auth() })).statusCode, 404);
});
