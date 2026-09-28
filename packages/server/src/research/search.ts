/**
 * Search providers.
 *
 * All keys are server-side. If none is configured the engine degrades to
 * website probing only and says so, rather than pretending it searched.
 */

import { config } from '../config.js';

export interface SearchResult {
  url: string;
  host: string;
  title: string;
  snippet: string;
}

export interface SearchOptions {
  intent?: 'careers' | 'jobs';
  limit?: number;
}

const TIMEOUT_MS = 15000;

export function providerName(): 'serper' | 'brave' | 'tavily' | null {
  if (config.search.serper) return 'serper';
  if (config.search.brave) return 'brave';
  if (config.search.tavily) return 'tavily';
  return null;
}

export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const provider = providerName();
  if (!provider) return [];
  const limit = opts.limit ?? 15;
  try {
    switch (provider) {
      case 'serper':
        return await serper(query, limit);
      case 'brave':
        return await brave(query, limit);
      case 'tavily':
        return await tavily(query, limit);
    }
  } catch (err) {
    console.error(`[search] ${provider} failed:`, err instanceof Error ? err.message : err);
    return [];
  }
  return [];
}

async function serper(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'x-api-key': config.search.serper, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: limit }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`serper HTTP ${res.status}`);
  const data = (await res.json()) as { organic?: Array<Record<string, string>> };
  return (data.organic ?? []).slice(0, limit).map((o) => toResult(o.link, o.title, o.snippet));
}

async function brave(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { 'x-subscription-token': config.search.brave, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<Record<string, string>> } };
  return (data.web?.results ?? []).slice(0, limit).map((o) => toResult(o.url, o.title, o.description));
}

async function tavily(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: config.search.tavily, query, max_results: limit, search_depth: 'basic' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
  const data = (await res.json()) as { results?: Array<Record<string, string>> };
  return (data.results ?? []).slice(0, limit).map((o) => toResult(o.url, o.title, o.content));
}

function toResult(url: string, title: string, snippet: string): SearchResult {
  let host = '';
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    host = '';
  }
  return { url, host, title: title ?? '', snippet: (snippet ?? '').slice(0, 300) };
}

/** Query tuned for finding a company's official careers page. */
export function careersQuery(company: string): string {
  return `${company} careers site official jobs open positions`;
}

/** Query tuned for finding specific live postings when a board is unavailable. */
export function jobsQuery(company: string, extra = ''): string {
  return `"${company}" ${extra} jobs site:jobs OR site:careers OR site:greenhouse.io OR site:lever.co OR site:workdayjobs.com OR site:smartrecruiters.com OR site:ashbyhq.com OR site:workable.com`.trim();
}
