/**
 * Applicant-tracking-system adapters.
 *
 * These use each vendor's public JSON endpoints (the same ones their own job
 * widgets call). Where an endpoint is gated or rate-limited, the adapter
 * reports the failure and the orchestrator falls back to HTML extraction.
 * No adapter logs in, solves CAPTCHAs, or replays session tokens.
 */

import { load } from 'cheerio';
import { collapseWhitespace, parseJobDate } from '@jet/shared';
import { politeFetch, rawFetch } from './http.js';
import type { RawJob } from './extract.js';
import { mergeExtracted, extractHeuristic, extractJsonLd, extractMicrodata, looksLikeJobDetailPage } from './extract.js';

export interface AdapterContext {
  careersUrl: string;
  sourceName: string;
  isOfficial: boolean;
}

export interface AdapterResult {
  jobs: RawJob[];
  ok: boolean;
  detail?: string;
  /** True when the listing was actually read, so absences are meaningful. */
  authoritative: boolean;
}

type Adapter = (ctx: AdapterContext) => Promise<AdapterResult>;

const notAuthoritative = (jobs: RawJob[], detail: string): AdapterResult => ({
  jobs, ok: jobs.length > 0, detail, authoritative: false,
});

export const detectProvider = (url: string): string | null => {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const rules: Array<[string, RegExp]> = [
    ['greenhouse', /(^|\.)greenhouse\.io$/i],
    ['lever', /(^|\.)lever\.co$/i],
    ['workday', /myworkdayjobs\.com$/i],
    ['smartrecruiters', /smartrecruiters\.com$/i],
    ['ashby', /ashbyhq\.com$/i],
    ['workable', /workable\.com$/i],
    ['personio', /personio\.(com|de)$/i],
    ['bamboohr', /bamboohr\.com$/i],
    ['dayforce', /dayforcehcm\.com$/i],
    ['icims', /icims\.com$/i],
    ['successfactors', /successfactors\.com$/i],
  ];
  for (const [name, re] of rules) if (re.test(host)) return name;
  return null;
};

const ADAPTERS: Record<string, Adapter> = {
  greenhouse: greenhouse,
  lever: lever,
  workday: workday,
  smartrecruiters: smartrecruiters,
  ashby: ashby,
  workable: workable,
  personio: personio,
  bamboohr: bamboohr,
  dayforce: dayforce,
  icims: icims,
  successfactors: successfactors,
};

export async function runAdapter(careersUrl: string, sourceName: string, isOfficial: boolean): Promise<AdapterResult> {
  const provider = detectProvider(careersUrl);
  if (!provider) return generic(careersUrl, sourceName, isOfficial);
  const adapter = ADAPTERS[provider];
  if (!adapter) return generic(careersUrl, sourceName, isOfficial);
  try {
    return await adapter({ careersUrl, sourceName, isOfficial });
  } catch (err) {
    return generic(careersUrl, sourceName, isOfficial, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Greenhouse
// ---------------------------------------------------------------------------
// boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
async function greenhouse(ctx: AdapterContext): Promise<AdapterResult> {
  const m = /boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_]+)/i.exec(ctx.careersUrl);
  const token = m?.[1] ?? new URL(ctx.careersUrl).host.split('.')[0];
  if (!token) return notAuthoritative([], 'Could not determine the Greenhouse board token.');

  const api = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
  const res = await politeFetch(api, { accept: 'application/json', maxBytes: 8 * 1024 * 1024 });
  if (!res.ok) return notAuthoritative([], `Greenhouse API returned ${res.status || 'an error'}${res.blockedReason ? ` (${res.blockedReason})` : ''}.`);

  let data: { jobs?: Array<Record<string, any>> };
  try {
    data = JSON.parse(res.body);
  } catch {
    return notAuthoritative([], 'Greenhouse API returned a non-JSON response.');
  }

  const jobs: RawJob[] = (data.jobs ?? []).map((j) => {
    const content = stripTags(j.content ?? '');
    const parts = partition(content);
    return {
      externalJobId: j.id ? String(j.id) : null,
      title: collapseWhitespace(j.title ?? 'Untitled role'),
      description: content || null,
      location: collapseWhitespace(j.location?.name ?? ''),
      employmentType: null,
      postedAt: j.updated_at ?? j.absolute_url ?? null,
      closingAt: null,
      salary: null,
      department: j.departments?.[0]?.name ?? null,
      category: j.offices?.[0]?.name ?? null,
      url: j.absolute_url ?? `${ctx.careersUrl}#${j.id}`,
      sourceName: ctx.sourceName,
      isOfficial: ctx.isOfficial,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'JSON_LD',
    } satisfies RawJob;
  });

  return { jobs, ok: true, authoritative: true, detail: `Greenhouse board "${token}"` };
}

// ---------------------------------------------------------------------------
// Lever
// ---------------------------------------------------------------------------
// api.lever.co/v0/postings/<company>?mode=json
async function lever(ctx: AdapterContext): Promise<AdapterResult> {
  const u = new URL(ctx.careersUrl);
  const token = u.pathname.split('/').filter(Boolean).pop() ?? u.host.split('.')[0];
  const api = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
  const res = await politeFetch(api, { accept: 'application/json', maxBytes: 8 * 1024 * 1024 });
  if (!res.ok) return notAuthoritative([], `Lever API returned ${res.status || 'an error'}${res.blockedReason ? ` (${res.blockedReason})` : ''}.`);

  let data: Array<Record<string, any>>;
  try {
    data = JSON.parse(res.body);
  } catch {
    return notAuthoritative([], 'Lever API returned a non-JSON response.');
  }
  if (!Array.isArray(data)) return notAuthoritative([], 'Lever API returned an unexpected shape.');

  const jobs: RawJob[] = data.map((j) => {
    const parts = partition(`${j.description ?? ''}\n${j.additional ?? ''}\n${(j.lists ?? []).map((l: any) => `${l.text}\n${l.content}`).join('\n')}`);
    return {
      externalJobId: j.id ? String(j.id) : null,
      title: collapseWhitespace(j.text ?? 'Untitled role'),
      description: stripTags(`${j.description ?? ''}\n${j.additional ?? ''}\n${(j.lists ?? []).map((l: any) => l.content).join('\n')}`) || null,
      location: collapseWhitespace([j.categories?.location, j.categories?.team].filter(Boolean).join(', ')),
      employmentType: j.categories?.commitment ?? null,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      closingAt: null,
      salary: null,
      department: j.categories?.department ?? null,
      category: j.categories?.team ?? null,
      url: j.hostedUrl ?? j.applyUrl ?? ctx.careersUrl,
      sourceName: ctx.sourceName,
      isOfficial: ctx.isOfficial,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'JSON_LD',
    } satisfies RawJob;
  });

  return { jobs, ok: true, authoritative: true, detail: `Lever board "${token}"` };
}

// ---------------------------------------------------------------------------
// Workday
// ---------------------------------------------------------------------------
// JSON: POST <tenant>/<site>/wday/cxs/<tenant>/<site>/jobs
async function workday(ctx: AdapterContext): Promise<AdapterResult> {
  const m = /https?:\/\/([A-Za-z0-9-]+)\.myworkdayjobs\.com\/([^/]+)\/([^/]+)/i.exec(ctx.careersUrl);
  if (!m) return notAuthoritative([], 'Could not parse a Workday tenant/site from the URL.');
  const [, tenant, site] = m;
  const base = `https://${tenant}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;
  const jobsUrl = `${base}/jobs`;

  const res = await politeFetch(`${jobsUrl}?limit=20`, { accept: 'application/json', maxBytes: 2 * 1024 * 1024 });
  if (!res.ok || !res.contentType.includes('json')) {
    return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, `Workday API returned ${res.status || 'no JSON'}.`);
  }
  let data: { jobPostings?: Array<Record<string, any>>; total?: number };
  try {
    data = JSON.parse(res.body);
  } catch {
    return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, 'Workday API returned invalid JSON.');
  }

  const jobs: RawJob[] = (data.jobPostings ?? []).map((j) => ({
    externalJobId: j.jobReqId ?? j.externalPath ?? null,
    title: collapseWhitespace(j.title ?? 'Untitled role'),
    description: null, // Workday hides detail behind a second call; filled on drill-down.
    location: collapseWhitespace([j.locationsText, j.countryName].filter(Boolean).join(', ')),
    employmentType: j.workerType ?? null,
    postedAt: j.postedOn ?? null,
    closingAt: null,
    salary: null,
    department: null,
    category: null,
    url: `${ctx.careersUrl.replace(/\/[^/]*$/, '')}/${j.externalPath ?? j.jobReqId ?? ''}`,
    sourceName: ctx.sourceName,
    isOfficial: ctx.isOfficial,
    responsibilities: [],
    eligibilityRequirements: [],
    educationRequirement: null,
    experienceMin: null,
    experienceMax: null,
    requiredSkills: [],
    preferredSkills: [],
    extractionMethod: 'HEURISTIC',
  } satisfies RawJob));

  return {
    jobs,
    ok: jobs.length > 0,
    authoritative: true,
    detail: `Workday tenant "${tenant}/${site}" (${data.total ?? jobs.length} total listings; the first page was listed)`,
  };
}

// ---------------------------------------------------------------------------
// SmartRecruiters
// ---------------------------------------------------------------------------
async function smartrecruiters(ctx: AdapterContext): Promise<AdapterResult> {
  const u = new URL(ctx.careersUrl);
  const org = u.pathname.split('/').filter(Boolean).pop() ?? '';
  if (!org) return notAuthoritative([], 'Could not determine the SmartRecruiters organisation.');

  const listRes = await politeFetch(`https://api.smartrecruiters.com/v1/companies/${org}/postings?limit=100`, {
    accept: 'application/json',
    maxBytes: 8 * 1024 * 1024,
  });
  if (!listRes.ok) return notAuthoritative([], `SmartRecruiters API returned ${listRes.status || 'an error'}.`);

  let list: { content?: Array<{ id: string; name: string; location?: { city?: string; country?: string }; department?: { name?: string }; ref?: string; releasedDate?: string; absolute_url?: string }> };
  try {
    list = JSON.parse(listRes.body);
  } catch {
    return notAuthoritative([], 'SmartRecruiters API returned invalid JSON.');
  }

  const jobs: RawJob[] = (list.content ?? []).map((j) => ({
    externalJobId: String(j.id),
    title: collapseWhitespace(j.name ?? 'Untitled role'),
    description: null,
    location: collapseWhitespace([j.location?.city, j.location?.country].filter(Boolean).join(', ')),
    employmentType: null,
    postedAt: j.releasedDate ?? null,
    closingAt: null,
    salary: null,
    department: j.department?.name ?? null,
    category: null,
    url: `https://jobs.smartrecruiters.com/${org}/${j.id}`,
    sourceName: ctx.sourceName,
    isOfficial: ctx.isOfficial,
    responsibilities: [],
    eligibilityRequirements: [],
    educationRequirement: null,
    experienceMin: null,
    experienceMax: null,
    requiredSkills: [],
    preferredSkills: [],
    extractionMethod: 'HEURISTIC',
  } satisfies RawJob));

  return { jobs, ok: jobs.length > 0, authoritative: true, detail: `SmartRecruiters organisation "${org}"` };
}

// ---------------------------------------------------------------------------
// Ashby
// ---------------------------------------------------------------------------
async function ashby(ctx: AdapterContext): Promise<AdapterResult> {
  const m = /jobs\.ashbyhq\.com\/([A-Za-z0-9_-]+)/i.exec(ctx.careersUrl);
  if (!m) return notAuthoritative([], 'Could not determine the Ashby job board name.');
  const board = m[1];
  const res = await politeFetch(`https://api.ashbyhq.com/posting-api/job-board/${board}`, {
    accept: 'application/json',
    maxBytes: 8 * 1024 * 1024,
  });
  if (!res.ok) return notAuthoritative([], `Ashby API returned ${res.status || 'an error'}.`);

  let data: { jobs?: Array<Record<string, any>> };
  try {
    data = JSON.parse(res.body);
  } catch {
    return notAuthoritative([], 'Ashby API returned invalid JSON.');
  }

  const jobs: RawJob[] = (data.jobs ?? []).map((j) => {
    const parts = partition(`${j.descriptionHtml ?? ''}\n${j.descriptionPlain ?? ''}`);
    return {
      externalJobId: j.id ? String(j.id) : null,
      title: collapseWhitespace(j.title ?? 'Untitled role'),
      description: stripTags(j.descriptionHtml || j.descriptionPlain || '') || null,
      location: collapseWhitespace(j.location ?? ''),
      employmentType: j.employmentType ?? null,
      postedAt: j.publishedDate ?? j.updatedAt ?? null,
      closingAt: null,
      salary: null,
      department: j.department ?? null,
      category: j.team ?? null,
      url: j.jobUrl ?? j.applyUrl ?? `${ctx.careersUrl}#${j.id}`,
      sourceName: ctx.sourceName,
      isOfficial: ctx.isOfficial,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'JSON_LD',
    } satisfies RawJob;
  });

  return { jobs, ok: jobs.length > 0, authoritative: true, detail: `Ashby board "${board}"` };
}

// ---------------------------------------------------------------------------
// Workable
// ---------------------------------------------------------------------------
async function workable(ctx: AdapterContext): Promise<AdapterResult> {
  const m = /apply\.workable\.com\/([A-Za-z0-9_-]+)\/j\//i.exec(ctx.careersUrl);
  const token = m?.[1] ?? new URL(ctx.careersUrl).host.split('.')[0];
  const res = await politeFetch(`https://apply.workable.com/api/v3/accounts/${token}/jobs`, {
    accept: 'application/json',
    maxBytes: 8 * 1024 * 1024,
  });
  if (!res.ok) return notAuthoritative([], `Workable API returned ${res.status || 'an error'}.`);
  let data: { jobs?: Array<Record<string, any>> };
  try {
    data = JSON.parse(res.body);
  } catch {
    return notAuthoritative([], 'Workable API returned invalid JSON.');
  }
  const jobs: RawJob[] = (data.jobs ?? []).map((j) => {
    const parts = partition(`${j.description ?? ''}\n${j.requirements ?? ''}\n${j.benefits ?? ''}`);
    return {
      externalJobId: j.id ? String(j.id) : (j.shortcode ?? null),
      title: collapseWhitespace(j.title ?? 'Untitled role'),
      description: stripTags(`${j.description ?? ''}\n${j.requirements ?? ''}`) || null,
      location: collapseWhitespace([j.city, j.state, j.country].filter(Boolean).join(', ')),
      employmentType: j.employment_type ?? null,
      postedAt: j.published_on ?? null,
      closingAt: j.deadline ?? null,
      salary: null,
      department: j.department ?? null,
      category: null,
      url: j.url ?? j.application_url ?? ctx.careersUrl,
      sourceName: ctx.sourceName,
      isOfficial: ctx.isOfficial,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'JSON_LD',
    } satisfies RawJob;
  });
  return { jobs, ok: jobs.length > 0, authoritative: true, detail: `Workable account "${token}"` };
}

// ---------------------------------------------------------------------------
// Personio
// ---------------------------------------------------------------------------
async function personio(ctx: AdapterContext): Promise<AdapterResult> {
  const host = new URL(ctx.careersUrl).host;
  const res = await politeFetch(`https://${host}/xml`, { accept: 'text/xml', maxBytes: 8 * 1024 * 1024 });
  if (!res.ok || !res.body.includes('<job')) {
    return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, `Personio XML feed returned ${res.status || 'no jobs'}.`);
  }
  const $ = load(res.body, { xmlMode: true });
  const jobs: RawJob[] = [];
  $('job').each((_, el) => {
    const n = $(el);
    const title = collapseWhitespace(n.find('title').first().text() || n.attr('name') || '');
    if (!title) return;
    const parts = partition(`${n.find('description').text()}\n${n.find('requirements').text()}`);
    jobs.push({
      externalJobId: n.attr('id') ?? null,
      title,
      description: stripTags(`${n.find('description').text()}\n${n.find('requirements').text()}`) || null,
      location: collapseWhitespace(n.find('location').attr('name') ?? n.find('office').text() ?? ''),
      employmentType: n.find('type').attr('name') ?? null,
      postedAt: n.find('published_at').text() || null,
      closingAt: null,
      salary: null,
      department: n.find('department').text() || null,
      category: n.find('team').text() || null,
      url: n.find('url').text() || n.find('apply_url').text() || ctx.careersUrl,
      sourceName: ctx.sourceName,
      isOfficial: ctx.isOfficial,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'HEURISTIC',
    } satisfies RawJob);
  });
  return { jobs, ok: jobs.length > 0, authoritative: true, detail: `Personio feed for "${host}"` };
}

// ---------------------------------------------------------------------------
// BambooHR
// ---------------------------------------------------------------------------
async function bamboohr(ctx: AdapterContext): Promise<AdapterResult> {
  const m = /([A-Za-z0-9-]+)\.bamboohr\.com/i.exec(ctx.careersUrl);
  if (!m) return notAuthoritative([], 'Could not determine the BambooHR company token.');
  const res = await politeFetch(`https://api.bamboohr.com/api/gateway.php/${m[1]}/v1/meta/jobs`, {
    headers: { accept: 'application/json' },
    maxBytes: 4 * 1024 * 1024,
  });
  if (!res.ok) return notAuthoritative([], `BambooHR API returned ${res.status || 'an error'} (this endpoint often requires a public API key).`);
  let data: { jobs?: Array<Record<string, any>> };
  try {
    data = JSON.parse(res.body);
  } catch {
    return notAuthoritative([], 'BambooHR API returned invalid JSON.');
  }
  const jobs: RawJob[] = (data.jobs ?? []).map((j) => ({
    externalJobId: String(j.id ?? ''),
    title: collapseWhitespace(j.title ?? 'Untitled role'),
    description: null,
    location: collapseWhitespace(j.location ?? ''),
    employmentType: j.employmentStatus ?? null,
    postedAt: null,
    closingAt: null,
    salary: null,
    department: j.department ?? null,
    category: j.division ?? null,
    url: j.url ?? ctx.careersUrl,
    sourceName: ctx.sourceName,
    isOfficial: ctx.isOfficial,
    responsibilities: [],
    eligibilityRequirements: [],
    educationRequirement: null,
    experienceMin: null,
    experienceMax: null,
    requiredSkills: [],
    preferredSkills: [],
    extractionMethod: 'HEURISTIC',
  } satisfies RawJob));
  return { jobs, ok: jobs.length > 0, authoritative: true, detail: `BambooHR company "${m[1]}"` };
}

// ---------------------------------------------------------------------------
// Dayforce / ICIMS / SuccessFactors -> generic HTML
// ---------------------------------------------------------------------------
async function dayforce(ctx: AdapterContext): Promise<AdapterResult> {
  return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, 'Dayforce has no stable public JSON feed; using HTML extraction.');
}

async function icims(ctx: AdapterContext): Promise<AdapterResult> {
  return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, 'ICIMS serves a dynamic search; using HTML extraction.');
}

async function successfactors(ctx: AdapterContext): Promise<AdapterResult> {
  return generic(ctx.careersUrl, ctx.sourceName, ctx.isOfficial, 'SuccessFactors renders via client-side scripts; using HTML extraction.');
}

// ---------------------------------------------------------------------------
// Generic: JSON-LD, then microdata, then heuristic HTML
// ---------------------------------------------------------------------------
export async function generic(
  careersUrl: string,
  sourceName: string,
  isOfficial: boolean,
  note?: string,
): Promise<AdapterResult> {
  const res = await politeFetch(careersUrl, { maxBytes: 8 * 1024 * 1024 });
  if (!res.ok) {
    return {
      jobs: [],
      ok: false,
      authoritative: false,
      detail: note ?? (res.blockedReason
        ? `Source could not be verified: ${res.blockedReason}`
        : `Source could not be verified (HTTP ${res.status || 'network error'}${res.error ? `: ${res.error}` : ''}).`),
    };
  }
  if (!res.contentType.includes('html') && !res.body.trimStart().startsWith('{')) {
    return { jobs: [], ok: false, authoritative: false, detail: `Unsupported content type: ${res.contentType || 'unknown'}.` };
  }

  const structured = mergeExtracted([
    extractJsonLd(res.body, res.finalUrl, sourceName, isOfficial),
    extractMicrodata(res.body, res.finalUrl, sourceName, isOfficial),
  ]);

  if (structured.length > 0) {
    return { jobs: structured, ok: true, authoritative: true, detail: note ?? `${structured.length} postings from schema.org JobPosting data.` };
  }

  const heuristic = extractHeuristic(res.body, res.finalUrl, sourceName, isOfficial);
  return {
    jobs: heuristic,
    ok: heuristic.length > 0,
    authoritative: heuristic.length > 0,
    detail: note ?? (heuristic.length > 0
      ? `${heuristic.length} candidate postings found by link-pattern matching (no schema.org data on this page).`
      : 'No schema.org JobPosting data and no recognisable job listings found on this page.'),
  };
}

/**
 * Second-pass enrichment for listings whose description lives on their own
 * page (Workday, and any link-only board). Bounded so a research run stays fast.
 */
export async function enrich(
  jobs: RawJob[],
  sourceName: string,
  isOfficial: boolean,
  limit: number,
): Promise<RawJob[]> {
  const needs = jobs.filter((j) => !j.description || j.description.length < 250).slice(0, limit);
  if (needs.length === 0) return jobs;

  const enriched = new Map<string, RawJob>();
  for (const j of needs) {
    const res = await politeFetch(j.url, { maxBytes: 3 * 1024 * 1024 });
    if (!res.ok || !res.contentType.includes('html')) {
      enriched.set(j.url, j);
      continue;
    }
    const structured = mergeExtracted([
      extractJsonLd(res.body, res.finalUrl, sourceName, isOfficial),
      extractMicrodata(res.body, res.finalUrl, sourceName, isOfficial),
    ]);
    if (structured.length > 0) {
      enriched.set(j.url, { ...j, ...structured[0], url: j.url, externalJobId: j.externalJobId ?? structured[0].externalJobId });
      continue;
    }
    const $ = load(res.body);
    const text = collapseWhitespace($('main, article, [role=main], #main, .job-description, [class*=description]').first().text() || $('body').text());
    const parts = partition(text);
    enriched.set(j.url, {
      ...j,
      description: text || j.description,
      responsibilities: parts.responsibilities,
      eligibilityRequirements: parts.requirements,
      educationRequirement: parts.education ?? j.educationRequirement,
    });
  }

  return jobs.map((j) => enriched.get(j.url) ?? j);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

const DEGREE_RE = /\b(bachelor|b\.?tech|b\.?sc|b\.?e\.?|master|m\.?tech|m\.?sc|ph\.?d|doctorate|degree in)\b/i;

function partition(text: string): { responsibilities: string[]; requirements: string[]; education: string | null } {
  const statements = text
    .split(/(?<=[.;!?])\s+|\n+|•+|·+/)
    .map((s) => collapseWhitespace(s))
    .filter((s) => s.length > 12);
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  let education: string | null = null;
  for (const s of statements) {
    if (DEGREE_RE.test(s) && s.length < 300 && !education) {
      education = s;
      requirements.push(s);
      continue;
    }
    if (/\b(responsibilit|what you will do|your role|day-to-day|duties)\b/i.test(s)) responsibilities.push(s);
    else if (/\b(requirement|qualification|must|should have|we.re looking for|experience in|knowledge of)\b/i.test(s)) requirements.push(s);
  }
  return { responsibilities, requirements, education };
}

export { parseJobDate, rawFetch };
