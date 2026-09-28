/**
 * API routes.
 *
 * One concern per file. Handlers are thin: validate, call the repository or
 * the research engine, shape the response. No business rules live in here.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import {
  createCompany,
  dashboardSummary,
  deleteCompany,
  findCompanyByName,
  getCompany,
  getEmailPrefs,
  getJob,
  insertNotification,
  jobFacets,
  jobSources,
  jobsClosingWithin,
  listCompanies,
  listNotifications,
  loadCompanyJobs,
  loadEligibility,
  mapJob,
  loadProfile,
  loadRequirements,
  markNotificationsRead,
  profileGaps,
  queryJobs,
  saveCandidates,
  saveEligibility,
  saveProfile,
  setEmailPrefs,
  updateCompany,
  unreadNotificationCount,
} from '../services/store.js';
import { listRuns, getRun } from '../services/runs.js';
import { researchCompany } from '../research/orchestrator.js';
import { resolveCareers } from '../research/careersUrl.js';
import { searchWeb, careersQuery, providerName } from '../research/search.js';
import { discoverCompanies } from '../research/discovery.js';
import { analyzeEligibility, extractRequirements, type JobQuery, type ProfilePatch } from '@jet/shared';
import { buildCsv, buildExcel, buildPdf } from '../services/export.js';
import { sendEligibleDigest } from '../services/email.js';
import { startResearch, researchStatus, inFlight } from '../services/jobs.js';
import {
  createUser,
  ensureProfileRow,
  findUserByEmail,
  hashPassword,
  upsertSupabaseUser,
  verifyPassword,
  verifySupabaseToken,
} from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

function currentUser(req: FastifyRequest): string {
  return req.userId;
}

async function readToken(req: FastifyRequest): Promise<string | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** The app instance as it exists after @fastify/jwt has been registered. */
type JwtApp = FastifyInstance & {
  jwt: {
    sign: (payload: object, opts?: object) => string;
    verify: <T = Record<string, unknown>>(token: string) => T;
  };
};

export async function registerRoutes(app: JwtApp): Promise<void> {
  // --- Authentication -----------------------------------------------------
  // The hook is added to the root instance (not a nested scope) so it applies
  // to every route registered below, including the public ones, which simply
  // ignore the resolved user.
  app.decorateRequest('userId', '');
  app.addHook('onRequest', async (req) => {
    const token = await readToken(req);
    if (!token) return;

    if (config.auth.mode === 'supabase') {
      const claims = verifySupabaseToken(token);
      if (!claims) return;
      req.userId = upsertSupabaseUser(claims.sub, claims.email).id;
      return;
    }

    try {
      const payload = app.jwt.verify<{ sub: string }>(token);
      if (typeof payload?.sub === 'string') {
        req.userId = payload.sub;
        ensureProfileRow(req.userId);
      }
    } catch {
      // An invalid token is treated as anonymous; the route guard returns 401.
    }
  });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.userId) {
      await reply.code(401).send({ error: 'Sign in to continue.' });
    }
  };

  // --- Health / capabilities ---------------------------------------------
  app.get('/api/health', async () => ({
    ok: true,
    env: config.env,
    authMode: config.auth.mode,
    capabilities: {
      searchProvider: providerName(),
      ai: config.ai.enabled ? (config.ai.anthropicKey ? 'anthropic' : 'openai') : null,
      email: Boolean(config.email.resendKey),
      scheduler: config.scheduler.enabled,
    },
  }));

  // --- Auth ---------------------------------------------------------------
  app.post('/api/auth/signup', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(10, 'Use at least 10 characters.') })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Invalid input.' });
    }
    if (findUserByEmail(body.data.email)) {
      return reply.code(409).send({ error: 'An account with that email already exists.' });
    }
    const user = createUser(body.data.email, await hashPassword(body.data.password));
    ensureProfileRow(user.id);
    return reply.code(201).send({ token: app.jwt.sign({ sub: user.id }, { expiresIn: '30d' }), user: { id: user.id, email: user.email } });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your email and password.' });

    const user = findUserByEmail(body.data.email);
    // Same message either way so the endpoint does not confirm which emails exist.
    const ok = user ? await verifyPassword(body.data.password, user.passwordHash) : false;
    if (!user || !ok) return reply.code(401).send({ error: 'Incorrect email or password.' });

    ensureProfileRow(user.id);
    return { token: app.jwt.sign({ sub: user.id }, { expiresIn: '30d' }), user: { id: user.id, email: user.email } };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({
    userId: currentUser(req),
    profile: loadProfile(currentUser(req)),
    profileGaps: profileGaps(loadProfile(currentUser(req))),
  }));

  // --- Profile ------------------------------------------------------------
  const profileSchema = z.object({
    name: z.string().max(120).optional(),
    degree: z.string().max(120).optional(),
    branch: z.string().max(160).optional(),
    college: z.string().max(200).nullable().optional(),
    graduationYear: z.number().int().min(1950).max(2100).optional(),
    cgpa: z.number().min(0).max(100).nullable().optional(),
    cgpaScale: z.number().min(1).max(100).optional(),
    gateScore: z.number().int().nullable().optional(),
    gateRank: z.number().int().nullable().optional(),
    gateYear: z.number().int().nullable().optional(),
    gateBranch: z.string().max(120).nullable().optional(),
    yearsOfExperience: z.number().min(0).max(60).optional(),
    minDesiredExperience: z.number().min(0).max(60).optional(),
    maxDesiredExperience: z.number().min(0).max(60).optional(),
    internships: z.string().max(4000).optional(),
    certifications: z.array(z.string().max(200)).max(50).optional(),
    skills: z.array(z.string().max(120)).max(200).optional(),
    workAuthorization: z.array(z.string().max(120)).max(20).optional(),
    preferredLocations: z.array(z.string().max(120)).max(50).optional(),
    preferredJobTypes: z.array(z.string().max(120)).max(50).optional(),
    willingToRelocate: z.boolean().optional(),
  });

  app.get('/api/profile', { preHandler: requireAuth }, async (req) => {
    const p = loadProfile(currentUser(req));
    return { profile: p, gaps: profileGaps(p) };
  });

  app.put('/api/profile', { preHandler: requireAuth }, async (req, reply) => {
    const body = profileSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Invalid input.' });

    const before = loadProfile(currentUser(req));
    if (
      body.data.graduationYear !== undefined &&
      before &&
      body.data.graduationYear !== before.graduationYear
    ) {
      insertNotification({
        userId: currentUser(req),
        kind: 'ELIGIBLE_JOB_CHANGED',
        title: 'Profile changed',
        body: 'Your graduation year changed, so every job has been re-analysed. Open a company to refresh it now.',
      });
    }
    const profile = saveProfile(currentUser(req), body.data as ProfilePatch);
    return { profile, gaps: profileGaps(profile) };
  });

  // --- Dashboard ----------------------------------------------------------
  app.get('/api/dashboard', { preHandler: requireAuth }, async (req) => {
    const userId = currentUser(req);
    const profile = loadProfile(userId);
    return {
      summary: dashboardSummary(userId, profile),
      profileGaps: profileGaps(profile),
      recentJobs: queryJobs(userId, { status: 'ELIGIBLE', limit: 8, sort: 'NEWEST' }).items,
      closingSoon: jobsClosingWithin(userId, 7),
      recentRuns: listRuns(userId, undefined, 5),
      capabilities: {
        searchProvider: providerName(),
        ai: config.ai.enabled,
        email: Boolean(config.email.resendKey),
      },
    };
  });

  // --- Companies ----------------------------------------------------------
  app.get('/api/companies', { preHandler: requireAuth }, async (req) => ({ companies: listCompanies(currentUser(req)) }));

  app.post('/api/companies', { preHandler: requireAuth }, async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        officialWebsite: z.string().url().nullable().optional(),
        careersUrl: z.string().url().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter a company name and, optionally, valid URLs.' });

    const userId = currentUser(req);
    const existing = findCompanyByName(userId, body.data.name);
    if (existing) return reply.code(200).send({ company: existing, created: false });

    let official = body.data.officialWebsite ?? null;
    let careers = body.data.careersUrl ?? null;
    let provider: string | null = null;
    let confidence: number | null = careers ? 1 : null;
    let via: string | null = careers ? 'user provided' : null;

    if (!careers) {
      // Try to locate the official careers page so the first research run works.
      const resolved = await resolveCareers(body.data.name, official);
      if (resolved.candidates[0]) {
        official = resolved.officialWebsite ?? official;
        careers = resolved.candidates[0].careersUrl;
        provider = resolved.candidates[0].atsProvider;
        confidence = resolved.candidates[0].confidence;
        via = resolved.candidates[0].discoveredVia;
      }
    }

    const company = createCompany(userId, { name: body.data.name, officialWebsite: official, careersUrl: careers, atsProvider: provider, careersUrlSource: via, careersUrlConfidence: confidence });
    return reply.code(201).send({ company, created: true });
  });

  app.get('/api/companies/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = currentUser(req);
    const company = getCompany(userId, id);
    if (!company) return reply.code(404).send({ error: 'Company not found.' });
    const rows = loadCompanyJobs(id, userId, ['ACTIVE', 'EXPIRED', 'REMOVED']);
    return {
      company,
      jobs: rows.map((r) => ({ ...mapJob(r), eligibility: loadEligibility(r.id, userId) })),
      runs: listRuns(userId, id, 5),
    };
  });

  app.patch('/api/companies/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        officialWebsite: z.string().url().nullable().optional(),
        careersUrl: z.string().url().nullable().optional(),
        refreshMode: z.enum(['MANUAL', 'EVERY_6H', 'EVERY_12H', 'DAILY']).optional(),
        pinned: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input.' });
    const company = updateCompany(currentUser(req), id, body.data);
    if (!company) return reply.code(404).send({ error: 'Company not found.' });
    return { company };
  });

  app.delete('/api/companies/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteCompany(currentUser(req), id);
    if (!ok) return reply.code(404).send({ error: 'Company not found.' });
    return { ok: true };
  });

  /** Find companies by name, using a real search provider or site probing. */
  app.get('/api/companies/discover', { preHandler: requireAuth }, async (req, reply) => {
    const { q } = req.query as { q?: string };
    const term = (q ?? '').trim();
    if (term.length < 2) return reply.code(400).send({ error: 'Type at least two characters.' });
    const found = await discoverCompanies(term);
    return { candidates: found, provider: providerName() };
  });

  // --- Research -----------------------------------------------------------
  app.post('/api/companies/:id/research', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ careersUrl: z.string().url().nullable().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'The careers URL must be a valid http(s) URL.' });

    const userId = currentUser(req);
    const company = getCompany(userId, id);
    if (!company) return reply.code(404).send({ error: 'Company not found.' });

    if (!profileGaps(loadProfile(userId)).length) {
      // A missing skills list or degree would make every verdict guesswork.
      insertNotification({
        userId, kind: 'RESEARCH_FAILED', companyId: id,
        title: 'Profile incomplete',
        body: 'Complete your degree, branch, graduation year, skills, and preferred locations before researching. Verdicts computed on an incomplete profile are not trustworthy.',
      });
    }

    const existing = inFlight(userId, id);
    if (existing) return reply.code(202).send({ runId: existing, status: 'RUNNING', alreadyRunning: true });

    const runId = startResearch(userId, id, body.data.careersUrl ?? null);
    return reply.code(202).send({ runId, status: 'RUNNING', alreadyRunning: false });
  });

  app.get('/api/research/:runId', { preHandler: requireAuth }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const userId = currentUser(req);
  const live = researchStatus(runId);
  const run = getRun(userId, runId);
  // A run row may not exist yet for a very fast failure; report the live steps
  // rather than a 404 the client would render as "not found".
  if (!run && !live) return reply.code(404).send({ error: 'Research run not found.' });
  return { run: run ?? null, live };
  });

  app.get('/api/research', { preHandler: requireAuth }, async (req, reply) => {
    const { companyId } = req.query as { companyId?: string };
    return { runs: listRuns(currentUser(req), companyId) };
  });

  /** Re-analyze a company's active jobs without re-fetching the source. */
  app.post('/api/jobs/reanalyze', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ companyId: z.string().max(64).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Invalid input.' });

    const userId = currentUser(req);
    const profile = loadProfile(userId);
    if (!profile) return reply.code(409).send({ error: 'Complete your profile before re-analyzing jobs.' });

    const companyId = body.data.companyId;
    const rows = companyId
      ? loadCompanyJobs(companyId, userId, ['ACTIVE'])
      : listCompanies(userId).flatMap((c) => loadCompanyJobs(c.id, userId, ['ACTIVE']));

    let analyzed = 0;
    for (const row of rows) {
      const job = mapJob(row);
      const requirements = extractRequirements({
        title: job.title, description: job.description, educationRequirement: job.educationRequirement,
        experienceMin: job.experienceMin, experienceMax: job.experienceMax, location: job.location,
        employmentType: job.employmentType, requirementsText: job.eligibilityRequirements.join('\n'),
      });
      saveEligibility(analyzeEligibility(job, profile, requirements), requirements);
      analyzed += 1;
    }
    return { analyzed, engineNote: 'Verdicts are decided by the deterministic rule engine; match score is informational only.' };
  });

  /** Run research synchronously. Used by tests and the CLI, not the UI. */
  app.post('/api/companies/:id/research/sync', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = currentUser(req);
    const company = getCompany(userId, id);
    if (!company) return reply.code(404).send({ error: 'Company not found.' });
    const body = z.object({ careersUrl: z.string().url().nullable().optional() }).safeParse(req.body ?? {});
    // An omitted careersUrl means "use the one already stored for this company".
    const careersUrl = body.success && body.data.careersUrl !== undefined ? body.data.careersUrl : company.careersUrl;
    const steps: unknown[] = [];
    const summary = await researchCompany(company, (s) => steps.push(s), careersUrl);
    return { summary, steps };
  });

  // --- Jobs ---------------------------------------------------------------
  const jobQuerySchema = z.object({
    status: z.enum(['ALL', 'ELIGIBLE', 'INELIGIBLE', 'UNCERTAIN']).optional(),
    location: z.string().max(120).optional(),
    department: z.string().max(120).optional(),
    employmentType: z.string().max(80).optional(),
    experience: z.enum(['ENTRY', 'MID', 'SENIOR']).optional(),
    posted: z.enum(['ANY', 'TODAY', 'LAST_3_DAYS', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'OLDER']).optional(),
    sort: z.enum(['NEWEST', 'OLDEST', 'DEADLINE_SOONEST', 'ELIGIBILITY_FIRST']).optional(),
    search: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get('/api/jobs', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = jobQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid filter.' });
    const userId = currentUser(req);
    return { ...queryJobs(userId, parsed.data as JobQuery), facets: jobFacets(userId) };
  });

  app.get('/api/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = currentUser(req);
    const job = getJob(userId, id);
    if (!job) return reply.code(404).send({ error: 'Job not found.' });

    const requirements = loadRequirements(id);
    if (requirements) {
      return { job, requirements, eligibility: loadEligibility(id, userId), sources: jobSources(id) };
    }

    // Never analysed (for example, a job stored before a profile existed).
    // Compute on demand so the detail page is never empty.
    const profile = loadProfile(userId);
    if (!profile) return { job, requirements: null, eligibility: null, sources: jobSources(id) };
    const extracted = extractRequirements({
      title: job.title, description: job.description, educationRequirement: job.educationRequirement,
      experienceMin: job.experienceMin, experienceMax: job.experienceMax, location: job.location,
      employmentType: job.employmentType, requirementsText: job.eligibilityRequirements.join('\n'),
    });
    const result = analyzeEligibility(job, profile, extracted);
    saveEligibility(result, extracted);
    return { job, requirements: extracted, eligibility: result, sources: jobSources(id) };
  });

  // --- Notifications ------------------------------------------------------
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const { limit } = req.query as { limit?: string };
    const userId = currentUser(req);
    return {
      notifications: listNotifications(userId, Math.min(Number(limit) || 50, 200)),
      unread: unreadNotificationCount(userId),
    };
  });

  app.post('/api/notifications/read', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ ids: z.array(z.string().max(64)).min(1).max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Provide the notification ids to mark as read.' });
    return { updated: markNotificationsRead(currentUser(req), body.data.ids), unread: unreadNotificationCount(currentUser(req)) };
  });

  // --- Email preferences --------------------------------------------------
  app.get('/api/settings/email', { preHandler: requireAuth }, async (req) => ({
    prefs: getEmailPrefs(currentUser(req)),
    configured: Boolean(config.email.resendKey),
  }));

  app.put('/api/settings/email', { preHandler: requireAuth }, async (req, reply) => {
    const body = z
      .object({ enabled: z.boolean(), frequency: z.enum(['IMMEDIATELY', 'DAILY', 'WEEKLY']), email: z.string().email().nullable() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid email preferences.' });
    if (body.data.enabled && !config.email.resendKey) {
      return reply.code(409).send({ error: 'Email is not configured on this server. Add RESEND_API_KEY to enable it.' });
    }
    return { prefs: setEmailPrefs(currentUser(req), body.data) };
  });

  app.post('/api/settings/email/test', { preHandler: requireAuth }, async (req, reply) => {
    if (!config.email.resendKey) return reply.code(409).send({ error: 'Email is not configured on this server.' });
    const profile = loadProfile(currentUser(req));
    const sent = await sendEligibleDigest(currentUser(req), profile?.email ?? null);
    if (!sent) return reply.code(502).send({ error: 'The email provider did not accept the request.' });
    return { ok: true };
  });

  // --- Export -------------------------------------------------------------
  app.get('/api/export/:format', { preHandler: requireAuth }, async (req, reply) => {
    const { format } = req.params as { format: string };
    const userId = currentUser(req);
    const { items } = queryJobs(userId, { status: 'ALL', limit: 200 });
    const profile = loadProfile(userId);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="job-tracker-${stamp}.csv"`)
        .send(buildCsv(items));
    }
    if (format === 'xlsx') {
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="job-tracker-${stamp}.xlsx"`)
        .send(await buildExcel(items, profile?.name ?? 'My'));
    }
    if (format === 'pdf') {
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="job-tracker-${stamp}.pdf"`)
        .send(await buildPdf(items, profile));
    }
    return reply.code(400).send({ error: 'Format must be csv, xlsx, or pdf.' });
  });
}


