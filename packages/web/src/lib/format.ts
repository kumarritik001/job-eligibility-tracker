/** Presentation helpers. Pure functions, so they are easy to test and reuse. */

import type { EligibilityStatus } from '../types/api';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "5 min ago", "2 days ago". Returns null when the input is absent/invalid. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(seconds / 86_400), 'day');
  if (abs < 31_536_000) return rtf.format(Math.round(seconds / 2_592_000), 'month');
  return rtf.format(Math.round(seconds / 31_536_000), 'year');
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86_400_000);
}

/** Narrow the loosely-typed stored status from the DB to the real union. */
export function asEligibilityStatus(value: string | null | undefined): EligibilityStatus | null {
  return value === 'ELIGIBLE' || value === 'INELIGIBLE' || value === 'UNCERTAIN' ? value : null;
}

export interface StatusMeta {
  label: string;
  /** Glyph so status never depends on color alone. */
  glyph: string;
  className: string;
}

export const STATUS_META: Record<EligibilityStatus, StatusMeta> = {
  ELIGIBLE: { label: 'Eligible', glyph: '✓', className: 'bg-eligible-soft text-eligible border-eligible/30' },
  INELIGIBLE: { label: 'Ineligible', glyph: '✕', className: 'bg-ineligible-soft text-ineligible border-ineligible/30' },
  UNCERTAIN: { label: 'Uncertain', glyph: '?', className: 'bg-uncertain-soft text-uncertain border-uncertain/30' },
};

export function experienceLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `${min} yr` : `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

/** Joins a list for display without leaking `null` into the UI. */
export function joinOrNull(values: readonly (string | null | undefined)[], sep = ', '): string | null {
  const kept = values.filter((v): v is string => Boolean(v && v.trim()));
  return kept.length ? kept.join(sep) : null;
}

/** Turns a newline-delimited textarea into a trimmed list, dropping blanks. */
export function linesToList(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
