/**
 * Job posting extraction.
 *
 * Two layers:
 *   1. schema.org/JobPosting (JSON-LD and microdata) — the standards-based path,
 *      and the only one that reliably gives a real date and job ID.
 *   2. A heuristic HTML pass for pages with no structured data, which extracts
 *      candidate cards and keeps only ones that look like job postings.
 *
 * Layer 2 is deliberately conservative. If a page yields nothing it is better
 * to report "no postings could be parsed" than to invent a posting.
 */

import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { collapseWhitespace, parseJobDate, splitStatements, stripHtml, tokenSimilarity } from '@jet/shared';

export interface RawJob {
  externalJobId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  employmentType: string | null;
  postedAt: string | null;
  closingAt: string | null;
  salary: string | null;
  department: string | null;
  category: string | null;
  url: string;
  sourceName: string;
  isOfficial: boolean;
  responsibilities: string[];
  eligibilityRequirements: string[];
  educationRequirement: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  extractionMethod: 'JSON_LD' | 'MICRODATA' | 'HEURISTIC';
}

const SKILL_HINT = /\b(skill|proficien|knowledge|competenc|familiarity|expertise|tool)\w*/i;
const RESPONSIBLE_HINT = /\b(responsibilit|what you will do|the role|your role|duties|day-to-day|main tasks)\w*/i;
const REQUIREMENT_HINT = /\b(requirement|qualification|who we.re looking for|you have|we look for|minimum|skills? and|what you.ll need)\w*/i;

const DEGREE_HINT =
  /\b(bachelor|b\.?tech|b\.?sc|b\.?e\.?|master|m\.?tech|m\.?sc|ph\.?d|doctorate|degree in|graduate)\b/i;

// ---------------------------------------------------------------------------
// schema.org
// ---------------------------------------------------------------------------

export function extractJsonLd(html: string, pageUrl: string, sourceName: string, isOfficial: boolean): RawJob[] {
  const $ = load(html);
  const out: RawJob[] = [];
  const seen = new Set<string>();

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text?.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        return;
      }
    }
    for (const raw of flattenLd(parsed)) {
      if (!raw || typeof raw !== 'object') continue;
      const node = raw as Record<string, unknown>;
      const typeValue = node['@type'];
      const types: unknown[] = Array.isArray(typeValue) ? typeValue : [typeValue];
      if (!types.includes('JobPosting')) continue;
      const job = fromJobPosting(node, pageUrl, sourceName, isOfficial);
      const key = job.url + '|' + job.title;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(job);
    }
  });

  return out;
}

/** Microdata fallback: itemprop based JobPosting. */
export function extractMicrodata(html: string, pageUrl: string, sourceName: string, isOfficial: boolean): RawJob[] {
  const $ = load(html);
  const out: RawJob[] = [];
  $('[itemtype*="schema.org/JobPosting"]').each((_, el) => {
    const node = $(el);
    const get = (prop: string): string => {
      const v = node.find(`[itemprop="${prop}"]`).first();
      if (!v.length) return '';
      return collapseWhitespace(v.attr('content') ?? v.attr('href') ?? v.text() ?? '');
    };
    const title = get('title');
    if (!title) return;
    const desc = get('description');
    out.push({
      externalJobId: get('identifier') || null,
      title,
      description: desc || null,
      location: firstOf([get('jobLocation'), get('addressLocality')]) || null,
      employmentType: firstOf([get('employmentType'), get('industry')]) || null,
      postedAt: firstOf([get('datePosted'), get('validThrough')]) || null,
      closingAt: get('validThrough') || null,
      salary: get('baseSalary') || null,
      department: get('department') || null,
      category: get('occupationalCategory') || null,
      url: firstOf([get('url'), pageUrl]) || pageUrl,
      sourceName,
      isOfficial,
      responsibilities: [],
      eligibilityRequirements: [],
      educationRequirement: firstOf([get('educationRequirements')]) || null,
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'MICRODATA',
    } as RawJob);
  });
  return out;
}

function flattenLd(input: unknown, depth = 0): unknown[] {
  if (depth > 8 || input === null || input === undefined) return [];
  if (Array.isArray(input)) return input.flatMap((i) => flattenLd(i, depth + 1));
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: unknown[] = [obj];
    if ('@graph' in obj) out.push(...flattenLd(obj['@graph'], depth + 1));
    return out;
  }
  return [];
}

function fromJobPosting(node: Record<string, unknown>, pageUrl: string, sourceName: string, isOfficial: boolean): RawJob {
  const str = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return collapseWhitespace(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return str(v[0]);
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('@value' in o) return str(o['@value']);
      if ('@id' in o) return collapseWhitespace(String(o['@id']));
      // schema.org PropertyValue, the usual shape of identifier / jobId.
      if ('value' in o) return str(o['value']);
    }
    return '';
  };

  const locationNode = node.jobLocation;
  const location = extractAddress(locationNode) || str(locationNode) || null;

  const description = stripHtml(str(node.description)).trim() || null;
  const responsibilities = str(node.responsibilities) ? splitStatements(stripHtml(str(node.responsibilities))) : [];
  const quals = node.qualifications ?? node.educationRequirements ?? node.experienceRequirements;
  const eligibility = str(quals) ? splitStatements(stripHtml(str(quals))) : [];

  // experienceRequirements is often {monthsOfExperience: n}
  let expMin: number | null = null;
  let expMax: number | null = null;
  const er = node.experienceRequirements;
  if (er && typeof er === 'object' && !Array.isArray(er)) {
    const months = Number((er as Record<string, unknown>).monthsOfExperience);
    if (Number.isFinite(months) && months > 0) expMin = Math.round((months / 12) * 10) / 10;
  }

  const edReq = node.educationRequirements;
  let educationRequirement: string | null = null;
  if (edReq && typeof edReq === 'object' && !Array.isArray(edReq)) {
    const o = edReq as Record<string, unknown>;
    const cred = str(o.credentialCategory) || str(o.educationalCredentialAwarded);
    const about = str(o.aboutLocation) || str(o.alternativeOf) || '';
    educationRequirement = collapseWhitespace([cred, about].filter(Boolean).join(' ')) || null;
  } else {
    educationRequirement = str(edReq) || null;
  }

  return {
    externalJobId: str(node.identifier) || str(node.jobId) || null,
    title: str(node.title) || 'Untitled role',
    description,
    location,
    employmentType: str(node.employmentType) || null,
    postedAt: str(node.datePosted) || null,
    closingAt: str(node.validThrough) || null,
    salary: extractSalary(node.baseSalary, str),
    department: str(node.department) ?? null,
    category: str(node.occupationalCategory) || null,
    url: str(node.url) ? absolute(str(node.url), pageUrl) : pageUrl,
    sourceName,
    isOfficial,
    responsibilities,
    eligibilityRequirements: eligibility,
    educationRequirement,
    experienceMin: expMin,
    experienceMax: expMax,
    requiredSkills: [],
    preferredSkills: [],
    extractionMethod: 'JSON_LD',
  };
}

function extractAddress(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const o = Array.isArray(node) ? (node[0] as Record<string, unknown>) : (node as Record<string, unknown>);
  const addr = o.address;
  if (!addr) return str_(o.addressLocality ?? o.name);
  const a = Array.isArray(addr) ? (addr[0] as Record<string, unknown>) : (addr as Record<string, unknown>);
  return [str_(a.addressLocality), str_(a.addressRegion), str_(a.addressCountry)]
    .filter(Boolean)
    .join(', ');
}

function str_(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return collapseWhitespace(v);
  if (typeof v === 'object' && '@value' in (v as object)) return str_((v as Record<string, unknown>)['@value']);
  return '';
}

function extractSalary(node: unknown, str: (v: unknown) => string): string | null {
  if (!node || typeof node !== 'object') return null;
  const o = Array.isArray(node) ? (node[0] as Record<string, unknown>) : (node as Record<string, unknown>);
  const lo = str(o.value) || str(o.minValue);
  const hi = str(o.maxValue);
  const unit = String(o.unitText ?? '').toUpperCase();
  const cur = str(o.currency) || '';
  const parts = [
    lo && hi ? `${lo}-${hi}` : lo || hi,
    cur,
    ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'].includes(unit) ? `per ${unit.toLowerCase()}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function firstOf(values: string[]): string {
  for (const v of values) {
    const t = collapseWhitespace(v ?? '');
    if (t) return t;
  }
  return '';
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------------------
// Heuristic HTML pass
// ---------------------------------------------------------------------------

interface Card {
  title: string;
  url: string;
  containerText: string;
}

const TITLE_RE =
  /^(?:(?:apply|view|view job|details|read more|job title)\s*[:\-–]?\s*)?([A-Za-z][A-Za-z0-9/&+()'\-,. ]{3,90})$/;

const NOISE_TITLE = /^(home|careers?|jobs?|search|apply|view all|see all|read more|learn more|back|next|previous|menu|close|filter|sort|share|all jobs|open positions?|all openings?|view positions?|load more|show more|submit|sign in|log in|contact us)$/i;

const LOCATION_HINT =
  /\b(remote|hybrid|onsite|on-site|bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata|ahmedabad|chennai|gurgaon|gurugram|noida|jaipur|lucknow|indore|nagpur|kanpur|patna|bhopal|coimbatore|vadodara|surat|kochi|thiruvananthapuram|mysuru|mysore|chandigarh|dehradun|guwahati|bhubaneswar|visakhapatnam|vijayawada|raipur|ranchi|bhopal|jamshedpur|durgapur|howrah|kolkata|pune|goa|ludhiana|amritsar|agra|varanasi|puducherry|panipat|madurai|tiruchirappalli|tirupati|secunderabad|hyderabad)\b/i;

const DATE_HINT = /\b(posted|published|updated|closing|apply by|deadline|expires)\b[^.\n]{0,30}(\d{1,2}\s+[a-z]{3,9},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+days?\s+ago|\d+\s+\w+\s+ago|today|yesterday)/i;

/**
 * Heuristic extraction. Requires a link whose anchor text looks like a job
 * title, so nav links ("About us", "Life at X") are rejected.
 */
export function extractHeuristic(html: string, pageUrl: string, sourceName: string, isOfficial: boolean): RawJob[] {
  const $ = load(html);
  const cards: Card[] = [];
  const seenUrls = new Set<string>();

  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    if (!href) return;
    const url = absolute(href, pageUrl);
    if (!/^https?:/i.test(url)) return;
    if (seenUrls.has(url)) return;

    const anchorText = collapseWhitespace(a.text());
    if (!anchorText || anchorText.length < 5 || anchorText.length > 120) return;
    if (NOISE_TITLE.test(anchorText)) return;
    if (!TITLE_RE.test(anchorText)) return;
    if (a.parents('nav,header,footer').length > 0) return;

    // Nearest block-level ancestor that plausibly holds the whole listing.
    const container =
      a.closest('li, article, tr, .job, .job-card, .job-listing, .card, .result, [class*="job"], [class*="card"], [class*="result"], [class*="position"], [class*="opening"]').first();
    const scope = container.length ? container : a.parent();
    const containerText = collapseWhitespace(stripHtml(scope.html() ?? ''));

    seenUrls.add(url);
    cards.push({ title: cleanTitle(anchorText), url, containerText: containerText.slice(0, 4000) });
  });

  const out: RawJob[] = [];
  for (const card of cards) {
    const text = card.containerText;
    const hasSignal =
      LOCATION_HINT.test(text) ||
      DEGREE_HINT.test(text) ||
      /\b(full[- ]time|part[- ]time|contract|permanent|internship)\b/i.test(text) ||
      /\b\d{1,2}\s*(?:\+|-\s*\d{1,2})?\s*(?:years?|yrs?)\b/i.test(text) ||
      DATE_HINT.test(text);
    if (!hasSignal) continue;

    out.push({
      externalJobId: null,
      title: card.title,
      description: text || null,
      location: extractLocation(text),
      employmentType: extractEmploymentType(text),
      postedAt: null,
      closingAt: null,
      salary: extractSalaryText(text),
      department: null,
      category: null,
      url: card.url,
      sourceName,
      isOfficial,
      responsibilities: [],
      eligibilityRequirements: [],
      educationRequirement: extractEducationLine(text),
      experienceMin: null,
      experienceMax: null,
      requiredSkills: [],
      preferredSkills: [],
      extractionMethod: 'HEURISTIC',
    });
  }

  return out;
}

function cleanTitle(t: string): string {
  return collapseWhitespace(t.replace(/^(apply|view|view job|details)\s*(?:now|job)?\s*[:\-–]?\s*/i, ''));
}

function extractLocation(text: string): string | null {
  const m =
    /\b(?:location|based in|locations?)\s*[:\-–]\s*([A-Za-z ,.'-]{2,60})/i.exec(text) ??
    /\b([A-Za-z]+(?:,\s*[A-Za-z]+)?\s*[-–|]\s*(?:Remote|Hybrid|On-?site|Onsite|In-?office))\b/i.exec(text);
  if (m) return collapseWhitespace(m[1]);
  const loc = LOCATION_HINT.exec(text);
  if (loc) return loc[0];
  const remote = /\b(remote|hybrid|fully remote|work from home)\b/i.exec(text);
  return remote ? remote[0] : null;
}

function extractEmploymentType(text: string): string | null {
  const m = /\b(full[- ]time|part[- ]time|contract(?:ual)?|permanent|fixed[- ]term|internship|temporary|apprentice(?:ship)?)\b/i.exec(text);
  return m ? m[0] : null;
}

function extractSalaryText(text: string): string | null {
  const m = /(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)\s?[\d,]+(?:\s?(?:-|–|to)\s?(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)?\s?[\d,.]+)?\s*(?:lpa|lakh|lakhs|crore|cr|k|per annum|p\.a\.?|a year|annually|monthly|hourly)?/i.exec(text);
  if (!m) return null;
  const s = collapseWhitespace(m[0]);
  return /\d/.test(s) ? s : null;
}

function extractEducationLine(text: string): string | null {
  for (const sentence of splitStatements(text)) {
    if (DEGREE_HINT.test(sentence) && sentence.length < 300) return sentence;
  }
  return null;
}

/** Split a description into responsibilities / requirements / skills. */
export function partitionDescription(description: string): {
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  preferred: string[];
} {
  const statements = splitStatements(stripHtml(description));
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  const skills: string[] = [];
  const preferred: string[] = [];

  for (const s of statements) {
    if (s.length < 12) continue;
    if (PREFERRED_HINT.test(s)) {
      if (SKILL_HINT.test(s) || /:/i.test(s)) {
        preferred.push(s);
        continue;
      }
    }
    if (SKILL_HINT.test(s) && !DEGREE_HINT.test(s)) {
      skills.push(s);
      continue;
    }
    if (RESPONSIBLE_HINT.test(s)) {
      responsibilities.push(s);
      continue;
    }
    if (REQUIREMENT_HINT.test(s) || DEGREE_HINT.test(s) || /\bexperience\b/i.test(s)) {
      requirements.push(s);
      continue;
    }
    if (/\b(must|should|required|ability to|exposure to|familiarity with|knowledge of)\b/i.test(s)) {
      requirements.push(s);
    }
  }

  return { responsibilities, requirements, skills, preferred };
}

const PREFERRED_HINT = /\b(preferred|preferably|nice to have|good to have|desirable|advantageous|plus|bonus)\b/i;

// ---------------------------------------------------------------------------
// Page-level helpers
// ---------------------------------------------------------------------------

export function pageTitle($: CheerioAPI): string | null {
  const t = $('title').first().text();
  return collapseWhitespace(t) || null;
}

export function isProbablyJobBoard($: CheerioAPI): boolean {
  const anchors = $('a[href]');
  const total = anchors.length;
  if (total < 8) return false;
  let jobish = 0;
  anchors.each((_, el) => {
    const text = collapseWhitespace($(el).text());
    if (text.length < 4 || NOISE_TITLE.test(text)) return;
    if (TITLE_RE.test(text)) jobish += 1;
  });
  return jobish / Math.max(total, 1) > 0.25;
}

export function looksLikeJobDetailPage(html: string): boolean {
  const $ = load(html);
  if ($('script[type="application/ld+json"]').text().includes('JobPosting')) return true;
  if ($('[itemtype*="JobPosting"]').length > 0) return true;
  const text = collapseWhitespace(stripHtml($('body').html() ?? ''));
  if (text.length < 200) return false;
  return (
    DEGREE_HINT.test(text) &&
    /\b(experience|responsibilit|requirement|qualification|apply)\b/i.test(text) &&
    text.length > 400
  );
}

/** Deduplicate a mixed bag of raw jobs coming from several extractors. */
export function mergeExtracted(groups: RawJob[][]): RawJob[] {
  const out: RawJob[] = [];
  for (const g of groups) {
    for (const j of g) {
      const clash = out.find((o) => o.url === j.url || (tokenSimilarity(o.title, j.title) > 0.9 && o.location === j.location));
      if (!clash) {
        out.push(j);
        continue;
      }
      // Prefer the structured extraction, then the longer description.
      if (j.extractionMethod === 'JSON_LD' && clash.extractionMethod !== 'JSON_LD') {
        Object.assign(clash, j);
      } else if ((j.description?.length ?? 0) > (clash.description?.length ?? 0)) {
        clash.description = j.description;
        if (!clash.postedAt && j.postedAt) clash.postedAt = j.postedAt;
        if (!clash.closingAt && j.closingAt) clash.closingAt = j.closingAt;
      }
      if (!clash.externalJobId && j.externalJobId) clash.externalJobId = j.externalJobId;
    }
  }
  return out;
}

export { parseJobDate };
