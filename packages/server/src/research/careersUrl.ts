/**
 * Careers-URL discovery.
 *
 * Order of preference, per the spec:
 *   1. A careers URL the search engine (or a known registry) already knows.
 *   2. A known ATS pattern for that company domain.
 *   3. The company's own site: try common paths, then follow "Careers"/"Jobs"
 *      links from the homepage.
 *   4. A search for "<company> careers" restricted to the official domain.
 *
 * Every candidate carries a confidence score and the reason it was found, so
 * the user can confirm rather than trust a guess.
 */

import { load } from 'cheerio';
import type { CompanyCandidate } from '@jet/shared';
import { collapseWhitespace, normalizeCompanyName, slugify } from '@jet/shared';
import { politeFetch, userAgent } from './http.js';
import { searchWeb } from './search.js';

/** host patterns that reliably indicate a careers site or ATS board. */
const CAREERS_HOST_RE =
  /(careers|jobs|job|vacanc|recruit|apply|hire|hiring|employment|opportunit|talent)\./i;

const ATS_HOSTS: Array<{ re: RegExp; provider: string; boardPath: RegExp | null }> = [
  { re: /boards\.greenhouse\.io$/i, provider: 'greenhouse', boardPath: null },
  { re: /greenhouse\.io$/i, provider: 'greenhouse', boardPath: null },
  { re: /jobs\.lever\.co$/i, provider: 'lever', boardPath: null },
  { re: /myworkdayjobs\.com$/i, provider: 'workday', boardPath: /\/([^/]+)\/([^/]+)\/jobs\/?/i },
  { re: /jobs\.smartrecruiters\.com$/i, provider: 'smartrecruiters', boardPath: /\/([A-Za-z0-9_%-]+)\/?/ },
  { re: /jobs\.ashbyhq\.com$/i, provider: 'ashby', boardPath: null },
  { re: /apply\.workable\.com$/i, provider: 'workable', boardPath: /\/([A-Za-z0-9_%-]+)\/?/ },
  { re: /([A-Za-z0-9-]+)\.personio\.com$/i, provider: 'personio', boardPath: null },
  { re: /careers\.site$/i, provider: 'generic', boardPath: null },
  { re: /bamboohr\.com$/i, provider: 'bamboohr', boardPath: /\/jobs\/list\/?/ },
  { re: /dayforcehcm\.com$/i, provider: 'dayforce', boardPath: /\/job\/.*\/search\/job\/?/ },
  { re: /icims\.com$/i, provider: 'icims', boardPath: /\/jobs-search\/[^/]+\/job\// },
  { re: /taleo\.net$/i, provider: 'taleo', boardPath: null },
  { re: /successfactors\.com$/i, provider: 'successfactors', boardPath: null },
];

const COMMON_CAREERS_PATHS = [
  '/careers', '/careers/', '/careers/jobs', '/careers/openings', '/jobs', '/jobs/',
  '/en/careers', '/en/careers/', '/us/careers', '/en-us/careers', '/about/careers',
  '/join-us', '/joinus', '/join-us/', '/work-with-us', '/opportunities', '/open-positions',
  '/vacancies', '/openings', '/positions', '/search-jobs', '/jobsearch', '/talent',
  '/en/careers/jobs', '/career', '/career-opportunities', '/explore-careers',
];

const CAREERS_LINK_TEXT = /\b(careers?|job openings?|open positions?|join (?:us|our team)|work with us|vacancies|opportunities|search jobs?|employment|become a part of)\b/i;

const NOISE_TEXT = /\b(privacy|cookie|terms|legal|disclaimer|contact us|news|media|investor|about us|sustainability|supply chain|ethics|compliance|faq|search language|site map|home)\b/i;

export function atsProviderFor(url: string): { provider: string; boardPath: string | null } | null {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  for (const a of ATS_HOSTS) {
    if (a.re.test(host)) {
      const pathname = new URL(url).pathname;
      return { provider: a.provider, boardPath: a.boardPath ? pathname.match(a.boardPath)?.[0] ?? null : null };
    }
  }
  return null;
}

export interface ResolveOutcome {
  candidates: CompanyCandidate[];
  officialWebsite: string | null;
  notes: string[];
}

/**
 * Resolve a company name to a set of candidate career pages.
 * `userWebsite` lets the user override discovery entirely.
 */
export async function resolveCareers(
  companyName: string,
  userWebsite?: string | null,
): Promise<ResolveOutcome> {
  const notes: string[] = [];
  const byUrl = new Map<string, CompanyCandidate>();
  const add = (c: CompanyCandidate): void => {
    const existing = byUrl.get(c.careersUrl ?? '');
    if (!existing || c.confidence > existing.confidence) byUrl.set(c.careersUrl ?? '', c);
  };

  // --- 0. User-supplied website -------------------------------------------
  if (userWebsite?.trim()) {
    const site = normalizeUrl(userWebsite.trim());
    if (site) {
      notes.push(`Using the website you provided: ${site}`);
      const found = await probeWebsite(site, companyName);
      found.forEach(add);
      notes.push(...found.map((f) => `Found ${f.careersUrl} (${f.discoveredVia})`));
    }
  }

  // --- 1. Search engine ----------------------------------------------------
  const results = await searchWeb(companyName, { intent: 'careers' });
  if (results.length === 0) {
    notes.push(
      'No search API key is configured, so careers pages were discovered by probing company websites only. Set SERPER_API_KEY, BRAVE_API_KEY or TAVILY_API_KEY for better coverage.',
    );
  } else {
    notes.push(`Search returned ${results.length} candidate pages.`);
  }

  const officialDomain = findOfficialDomain(results, companyName);
  for (const r of results) {
    if (!CAREERS_LINK_TEXT.test(r.title) && !CAREERS_HOST_RE.test(r.host)) continue;
    add({
      name: companyName,
      officialWebsite: officialDomain,
      careersUrl: r.url,
      logoUrl: null,
      atsProvider: atsProviderFor(r.url)?.provider ?? null,
      confidence: scoreCandidate(r.url, r.title, officialDomain),
      discoveredVia: `search: ${r.title.slice(0, 70)}`,
    });
  }

  // --- 2. Probe the official website --------------------------------------
  if (officialDomain && !hasStrongCandidate(byUrl)) {
    const site = `https://${officialDomain}`;
    notes.push(`Probing ${site} for a careers section.`);
    const found = await probeWebsite(site, companyName);
    found.forEach(add);
    notes.push(...found.map((f) => `Found ${f.careersUrl} (${f.discoveredVia})`));
  }

  // --- 3. Direct guesses on the official domain --------------------------
  if (officialDomain) {
    for (const p of COMMON_CAREERS_PATHS.slice(0, 8)) {
      const url = `https://${officialDomain}${p}`;
      if (byUrl.has(url)) continue;
      const res = await politeFetch(url, { timeoutMs: 12000, maxBytes: 1_500_000 });
      if (!res.ok || !res.contentType.includes('html')) continue;
      const ats = atsProviderFor(res.finalUrl);
      add({
        name: companyName,
        officialWebsite: `https://${officialDomain}`,
        careersUrl: res.finalUrl,
        logoUrl: null,
        atsProvider: ats?.provider ?? null,
        confidence: scoreCandidate(res.finalUrl, '', officialDomain) - 0.05,
        discoveredVia: 'direct path probe',
      });
    }
  }

  if (byUrl.size === 0) {
    notes.push('Could not discover a careers page. Add the company\'s careers URL manually.');
  }

  const candidates = [...byUrl.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8);
  return { candidates, officialWebsite: officialDomain, notes };
}

function hasStrongCandidate(map: Map<string, CompanyCandidate>): boolean {
  for (const c of map.values()) if (c.confidence >= 0.75) return true;
  return false;
}

/** Fetch a company homepage and follow its careers links. */
async function probeWebsite(site: string, companyName: string): Promise<CompanyCandidate[]> {
  const out: CompanyCandidate[] = [];
  const seen = new Set<string>();

  const res = await politeFetch(site, { timeoutMs: 15000, maxBytes: 2_500_000 });
  if (!res.ok || !res.contentType.includes('html')) return out;

  const $ = load(res.body);
  const finalHost = safeHost(res.finalUrl);
  const links: Array<{ href: string; text: string }> = [];
  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    if (!href) return;
    const text = collapseWhitespace(a.text());
    if (text.length > 90 || NOISE_TEXT.test(text)) return;
    links.push({ href, text });
  });

  for (const { href, text } of links) {
    if (seen.size > 40) break;
    if (!CAREERS_LINK_TEXT.test(text) && !CAREERS_HOST_RE.test(safeHost(absUrl(href, res.finalUrl)))) continue;
    const abs = absUrl(href, res.finalUrl);
    if (seen.has(abs)) continue;
    seen.add(abs);

    const host = safeHost(abs);
    const isOwnSite = host === finalHost;
    if (isOwnSite && !CAREERS_LINK_TEXT.test(text)) continue;
    // Follow external links only when they look like an ATS host.
    if (!isOwnSite && !CAREERS_HOST_RE.test(host)) continue;

    const ats = atsProviderFor(abs);
    out.push({
      name: companyName,
      officialWebsite: `https://${finalHost}`,
      careersUrl: abs,
      logoUrl: null,
      atsProvider: ats?.provider ?? null,
      confidence: (isOwnSite ? 0.6 : 0.7) + (ats ? 0.15 : 0) + (CAREERS_LINK_TEXT.test(text) ? 0.15 : 0),
      discoveredVia: `homepage link: "${text.slice(0, 50)}"`,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function scoreCandidate(url: string, title: string, officialDomain: string | null): number {
  let score = 0.3;
  const host = safeHost(url);
  if (CAREERS_HOST_RE.test(host)) score += 0.25;
  if (atsProviderFor(url)) score += 0.2;
  if (CAREERS_LINK_TEXT.test(title)) score += 0.15;
  if (officialDomain && host === officialDomain) score += 0.1;
  if (/careers|jobs|vacanc|openings|positions/i.test(url)) score += 0.05;
  if (/\/(blog|news|article|press|media|about|investor|privacy|terms)(\/|$)/i.test(url)) score -= 0.3;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

/**
 * Pick the company's own domain out of search results.
 * Requires that the domain's token appears in the company name, which keeps
 * "Reliance" from resolving to reliance-retail.com when we asked for
 * "Reliance Industries".
 */
function findOfficialDomain(results: Array<{ url: string; host: string; title: string }>, companyName: string): string | null {
  const tokens = normalizeCompanyName(companyName).split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return null;
  const ignore = new Set([
    'www', 'linkedin', 'glassdoor', 'indeed', 'naukri', 'monster', 'ziprecruiter',
    'wikipedia', 'crunchbase', 'bloomberg', 'reuters', 'youtube', 'facebook',
    'twitter', 'x', 'instagram', 'medium', 'github', 'ambitionbox', 'instahyre',
    'foundit', 'internshala', 'timesofindia', 'economictimes', 'simplyhired',
    'jobberman', 'shine', 'cutshort', 'apna', 'trabajo', 'jora', 'jooble',
  ]);
  let best: { host: string; score: number } | null = null;
  for (const r of results) {
    const host = r.host.replace(/^www\./, '');
    if (ignore.has(host.split('.')[0])) continue;
    const hit = tokens.filter((t) => host.includes(t)).length;
    if (hit === 0) continue;
    const tldBonus = /\.(com|co\.in|com\.in|in|net|org)$/.test(host) ? 1 : 0;
    const lenBonus = host.split('.').length <= 3 ? 1 : 0;
    const score = hit * 2 + tldBonus + lenBonus;
    if (!best || score > best.score) best = { host, score };
  }
  return best?.host ?? null;
}

export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function absUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export { slugify, userAgent };
