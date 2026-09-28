/**
 * HTTP fetching for the research engine.
 *
 * Compliance rules baked in here, not left to the caller:
 *  - robots.txt is fetched and obeyed by default.
 *  - A descriptive User-Agent is required.
 *  - Per-host concurrency and a global delay prevent hammering a source.
 *  - No cookie jar, no auth replay, no attempt to read behind logins.
 *  - Timeouts and body-size caps stop runaway pages.
 */

import { config } from '../config.js';

const DEFAULT_UA =
  config.crawl.userAgent ||
  'JobEligibilityTracker/0.1 (respectful crawler; +mailto:you@example.com)';

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  contentType: string;
  body: string;
  blocked: boolean;
  blockedReason?: string;
  error?: string;
  elapsedMs: number;
}

class RobotsCache {
  private cache = new Map<string, { rules: RobotsGroup[]; fetchedAt: number }>();
  private inflight = new Map<string, Promise<RobotsGroup[]>>();

  async get(origin: string): Promise<RobotsGroup[]> {
    const hit = this.cache.get(origin);
    if (hit && Date.now() - hit.fetchedAt < 3_600_000) return hit.rules;
    const existing = this.inflight.get(origin);
    if (existing) return existing;
    const p = this.load(origin);
    this.inflight.set(origin, p);
    return p;
  }

  private async load(origin: string): Promise<RobotsGroup[]> {
    let rules: RobotsGroup[] = [];
    try {
      const res = await rawFetch(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 512 * 1024 });
      if (res.ok) rules = parseRobots(res.body);
      // A missing or unreachable robots.txt means no stated restrictions.
    } catch {
      rules = [];
    }
    this.cache.set(origin, { rules, fetchedAt: Date.now() });
    this.inflight.delete(origin);
    return rules;
  }
}

export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

/**
 * Parse robots.txt into groups. Blank `Disallow:` lines mean "allow everything"
 * per the spec and are dropped; a group with no Disallow imposes no restriction.
 */
function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      // Consecutive User-agent lines share one rule block.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value === '') continue;
    if (key === 'allow' || key === 'disallow') {
      current.rules.push({ type: key, path: value });
    }
  }

  return groups.filter((g) => g.rules.length > 0);
}

/** Pick the most specific agent group that matches our User-Agent. */
function selectGroup(groups: RobotsGroup[]): RobotsRule[] {
  if (groups.length === 0) return [];
  const ua = DEFAULT_UA.toLowerCase();
  let bestMatch = -1;
  let bestLen = 0;
  let wildcard: RobotsRule[] | null = null;

  groups.forEach((g, i) => {
    for (const a of g.agents) {
      if (a === '*') {
        wildcard = wildcard ?? g.rules;
      } else if (ua.includes(a) && a.length > bestLen) {
        bestLen = a.length;
        bestMatch = i;
      }
    }
  });

  if (bestMatch >= 0) return groups[bestMatch].rules;
  return wildcard ?? [];
}

export function robotsAllows(groups: RobotsGroup[], pathname: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of selectGroup(groups)) {
    if (!pathMatches(r.path, pathname)) continue;
    // Longest matching rule wins; Allow beats Disallow on ties.
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow')) {
      best = { len, allow: r.type === 'allow' };
    }
  }
  return best ? best.allow : true;
}

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern === '') return false;
  const p = pattern.replace(/\$$/, '');
  if (p.includes('*')) {
    const re = new RegExp('^' + p.split('*').map(escapeRe).join('.*') + (pattern.endsWith('$') ? '$' : ''));
    return re.test(pathname);
  }
  return pathname.startsWith(p);
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const robots = new RobotsCache();

/** Raw fetch with no robots check (used only to read robots.txt itself). */
export async function rawFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? config.crawl.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': DEFAULT_UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IN,en;q=0.9',
        ...opts.headers,
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const maxBytes = opts.maxBytes ?? 6 * 1024 * 1024;
    const body = await readCapped(res, maxBytes);
    return {
      ok: res.ok,
      status: res.status,
      url,
      finalUrl: res.url || url,
      contentType,
      body,
      blocked: false,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      finalUrl: url,
      contentType: '',
      body: '',
      blocked: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// --- Politeness ------------------------------------------------------------

const hostQueues = new Map<string, Promise<unknown>>();
let globalDelay = 0;
const delayMs = (): number => globalDelay;

export function configureCrawler(opts: { delayMs?: number }): void {
  globalDelay = opts.delayMs ?? config.crawl.requestDelayMs;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Serialise requests per host and space them out. */
async function withHostQueue<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  hostQueues.set(
    host,
    next.catch(() => undefined),
  );
  await prev.catch(() => undefined);
  return next;
}

// --- Public API ------------------------------------------------------------

const BLOCK_MARKERS = [
  'just a moment',
  'checking your browser',
  'enable javascript and cookies',
  'attention required',
  'captcha',
  'access denied',
  'please verify you are human',
  'unusual traffic',
  'request unsuccessful',
];

/**
 * Polite GET that respects robots.txt, detects bot walls, and reports why it
 * failed so the UI can say "source could not be verified" instead of guessing.
 */
export async function politeFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; accept?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
      blocked: false, error: `Invalid URL: ${url}`, elapsedMs: 0,
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
      blocked: false, error: `Unsupported protocol: ${parsed.protocol}`, elapsedMs: 0,
    };
  }

  if (config.crawl.respectRobots) {
    const rules = await robots.get(parsed.origin);
    if (!robotsAllows(rules, parsed.pathname + parsed.search)) {
      return {
        ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
        blocked: true, blockedReason: 'Disallowed by the site\'s robots.txt',
        elapsedMs: 0,
      };
    }
  }

  if (delayMs() > 0) await sleep(delayMs());

  const result = await withHostQueue(url, () =>
    rawFetch(url, {
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      headers: {
        ...(opts.accept ? { accept: opts.accept } : {}),
        ...(opts.headers ?? {}),
      },
    }),
  );

  if (result.ok && result.contentType.includes('html')) {
    const head = result.body.slice(0, 4000).toLowerCase();
    for (const marker of BLOCK_MARKERS) {
      if (head.includes(marker)) {
        return {
          ...result,
          ok: false,
          blocked: true,
          blockedReason: `Bot protection detected ("${marker}"). Not bypassing.`,
        };
      }
    }
  }
  return result;
}

export function maxPages(): number {
  return config.crawl.maxPagesPerCompany;
}

export function userAgent(): string {
  return DEFAULT_UA;
}
