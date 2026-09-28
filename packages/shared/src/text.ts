/** Small, dependency-free text utilities used across the engine. */

const LEGAL_SUFFIXES = [
  'inc', 'inc.', 'llc', 'l.l.c', 'ltd', 'ltd.', 'limited', 'corp', 'corp.', 'corporation',
  'co', 'co.', 'company', 'plc', 'plc.', 'gmbh', 'ag', 'sa', 's.a', 's.a.', 'nv', 'n.v',
  'bv', 'b.v', 'pty', 'pvt', 'pvt.', 'private', 'group', 'holdings', 'holding',
  'the', 'and',
];

/**
 * Canonical key for a company name so "Tata Chemicals Limited" and
 * "tata chemicals ltd." collapse to the same row.
 */
export function normalizeCompanyName(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/[''`]/g, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const parts = s.split(' ').filter(Boolean);
  while (parts.length > 1 && LEGAL_SUFFIXES.includes(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(' ');
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Lowercased, punctuation-stripped form for fuzzy comparisons. */
export function comparable(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'with', 'on',
  'we', 'you', 'our', 'your', 'will', 'is', 'are', 'as', 'by', 'new', 'all',
  'job', 'jobs', 'position', 'positions', 'role', 'roles', 'opening', 'openings',
  'm', 'f', 'd', 'w',
]);

export function tokenize(input: string): string[] {
  return comparable(input)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard similarity over token sets, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export function locationKey(input: string | null | undefined): string {
  if (!input) return '';
  return comparable(input)
    .replace(/\b(remote|hybrid|onsite|on site|in office|full time|part time|contract|permanent|india|worldwide|global)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract quoted evidence for a regex match so explanations stay grounded. */
export function evidenceAround(text: string, index: number, length: number, pad = 90): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return collapseWhitespace(text.slice(start, end));
}

/** Sentence-split that tolerates bullet lists and headings. */
export function splitStatements(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+|•+|·+/g)
    .map((s) => collapseWhitespace(s))
    .filter((s) => s.length > 2);
}

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

export function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Parse the many date shapes job boards emit. Returns an ISO date string
 * (YYYY-MM-DD) or null. Never guesses: unrecognised input yields null so the UI
 * can show "Not specified in posting" instead of a fabricated date.
 */
export function parseJobDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = collapseWhitespace(String(input));
  if (!s) return null;

  // Relative: "3 days ago", "2 weeks ago", "just now", "today"
  const rel = /^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const days = unit === 'minute' ? 0 : unit === 'hour' ? 0 : unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
    const d = new Date(Date.now() - days * 86_400_000);
    return toIsoDate(d);
  }
  if (/^(just now|today|posted today)$/i.test(s)) return toIsoDate(new Date());

  // ISO / ISO datetime
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Numeric with slashes/dashes: 24/09/2026, 09-24-2026, 24.09.2026
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    // Disambiguate: a value > 12 can only be a day.
    if (a > 12 && b <= 12) return `${y}-${pad(b)}-${pad(a)}`;
    if (b > 12 && a <= 12) return `${y}-${pad(a)}-${pad(b)}`;
    return `${y}-${pad(b)}-${pad(a)}`; // assume DD/MM (dominant in IN/EU job boards)
  }

  // "24 Sep 2026", "Sep 24, 2026", "24 September 2026", with optional time
  m = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})/i.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo !== undefined) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`;
  }
  m = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`;
  }

  // Bare year-month: 2026-09 handled above; "September 2026"
  m = /^([a-z]+)\s+(\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) return `${m[2]}-${pad(mo + 1)}-01`;
  }

  // Unix epoch seconds or millis
  if (/^\d{10}$/.test(s)) return toIsoDate(new Date(Number(s) * 1000));
  if (/^\d{13}$/.test(s)) return toIsoDate(new Date(Number(s)));

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Days between two ISO dates (b - a). Positive when b is later. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86_400_000);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
