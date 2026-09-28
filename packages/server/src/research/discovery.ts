/**
 * Company discovery.
 *
 * Used by the "add company" autocomplete. With a search API key this queries
 * the provider; without one it probes a small set of well-known official
 * domains and verifies the careers page actually responds. It never invents a
 * company: every candidate must come from a real search result or a confirmed
 * HTTP response.
 */

import type { CompanyCandidate } from '@jet/shared';
import { normalizeCompanyName, slugify } from '@jet/shared';
import { politeFetch } from './http.js';
import { atsProviderFor, normalizeUrl } from './careersUrl.js';
import { providerName, searchWeb } from './search.js';

const CAREERS_PATH_HINTS = [
  '/careers', '/careers/', '/jobs', '/jobs/', '/career', '/career/',
  '/join-us', '/joinus', '/vacancies', '/vacancies/', '/openings',
  '/opportunities', '/work-with-us', '/en/careers', '/about/careers',
];

const ATS_HOSTS = [
  'jobs.ashbyhq.com', 'job-boards.greenhouse.io', 'boards.greenhouse.io', 'jobs.lever.co',
  'apply.workable.com', 'careers.smartrecruiters.com', 'jobs.smartrecruiters.com',
  'myworkdayjobs.com', 'jobs.personio.de', 'jobs.personio.com', 'bamboohr.com',
];

/** Domains worth probing when the user has no search key configured. */
function probeDomains(company: string): Array<{ host: string; label: string }> {
  const slug = slugify(company);
  const short = slug.split('-')[0];
  return [
    { host: `${slug}.com`, label: 'company domain' },
    { host: `${short}.com`, label: 'company domain' },
    { host: `careers.${slug}.com`, label: 'careers subdomain' },
  ].filter((d, i, arr) => arr.findIndex((x) => x.host === d.host) === i);
}

export async function discoverCompanies(term: string): Promise<CompanyCandidate[]> {
  const company = term.trim();
  if (company.length < 2) return [];

  if (providerName()) {
    return fromSearch(company);
  }
  return fromProbing(company);
}

async function fromSearch(company: string): Promise<CompanyCandidate[]> {
  const results = await searchWeb(`${company} official website careers`, { intent: 'careers', limit: 12 });
  const out: CompanyCandidate[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    let host: string;
    try {
      host = new URL(r.url).host.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);

    const ats = atsProviderFor(r.url);
    const isAts = Boolean(ats) || ATS_HOSTS.some((h) => host.endsWith(h));
    const looksCareers = /career|job|vacanc|opening|hiring|position/i.test(r.url) || /career|job|hiring|opening/i.test(r.title);

    out.push({
      name: looksCareers || isAts ? company : r.title.split(/[|\-–]/)[0].trim() || company,
      officialWebsite: isAts ? null : `https://${host}`,
      careersUrl: normalizeUrl(r.url),
      logoUrl: null,
      atsProvider: ats?.provider ?? null,
      // A careers-looking URL from a search hit is decent evidence; the
      // orchestrator still verifies the source before trusting a posting.
      confidence: isAts ? 0.9 : looksCareers ? 0.7 : 0.4,
      discoveredVia: `search result (${r.host})`,
    });
  }
  return out.slice(0, 10);
}

async function fromProbing(company: string): Promise<CompanyCandidate[]> {
  const normalized = normalizeCompanyName(company);
  const out: CompanyCandidate[] = [];
  const atsHosts: CompanyCandidate[] = [];

  // 1. Probe the company's own site for a careers page.
  for (const { host, label } of probeDomains(company).slice(0, 2)) {
    const base = `https://${host}`;
    const root = await politeFetch(base, { timeoutMs: 8000, maxBytes: 512 * 1024 });
    if (!root.ok || !root.contentType.includes('html')) continue;

    for (const path of CAREERS_PATH_HINTS.slice(0, 8)) {
      const url = `${base}${path}`;
      const res = await politeFetch(url, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024 });
      if (!res.ok || !res.contentType.includes('html')) continue;

      const ats = atsProviderFor(res.finalUrl);
      if (ats) {
        atsHosts.push({
          name: company, officialWebsite: base, careersUrl: res.finalUrl, logoUrl: null,
          atsProvider: ats.provider, confidence: 0.9, discoveredVia: `${label} (${host}${path})`,
        });
        break;
      }
      if (/\b(no (open|current) (job|vacanc)|no position|do not have any|check back)\b/i.test(res.body.slice(0, 6000))) {
        // A real careers page that says it has nothing is still a valid target.
        out.push({
          name: company, officialWebsite: base, careersUrl: res.finalUrl, logoUrl: null,
          atsProvider: null, confidence: 0.8, discoveredVia: `${label} (${host}${path}, currently no openings)`,
        });
        break;
      }
      if (/(job|vacanc|opening|position)/i.test(res.body) && /apply/i.test(res.body)) {
        out.push({
          name: company, officialWebsite: base, careersUrl: res.finalUrl, logoUrl: null,
          atsProvider: null, confidence: 0.8, discoveredVia: `${label} (${host}${path})`,
        });
        break;
      }
    }
    if (out.length > 0 || atsHosts.length > 0) break;
  }

  const deduped = dedupe([...atsHosts, ...out], normalized);
  if (deduped.length > 0) {
    return deduped;
  }

  // 2. No search key and no reachable site: say so rather than guessing.
  return [
    {
      name: company,
      officialWebsite: null,
      careersUrl: null,
      logoUrl: null,
      atsProvider: null,
      confidence: 0,
      discoveredVia: 'no search API key configured and no company domain responded',
    },
  ];
}

function dedupe(list: CompanyCandidate[], normalized: string): CompanyCandidate[] {
  const seenUrls = new Set<string>();
  const out: CompanyCandidate[] = [];
  for (const c of list) {
    const key = c.careersUrl ?? c.officialWebsite ?? normalizeCompanyName(c.name);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    out.push({ ...c, name: c.name || normalized });
  }
  return out.slice(0, 8);
}
