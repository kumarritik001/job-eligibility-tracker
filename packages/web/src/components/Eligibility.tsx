/**
 * Eligibility badge and check list.
 *
 * Everything shown here comes from the server's EligibilityResult. The
 * component performs no matching of its own -- if the backend sends a check
 * with an outcome, that outcome is what the user sees.
 */

import type { CheckOutcome, EligibilityCheck, EligibilityResult, EligibilityStatus } from '../types/api';
import { STATUS_META, asEligibilityStatus } from '../lib/format';

export function EligibilityBadge({
  status,
  size = 'md',
}: {
  status: string | null | undefined;
  size?: 'sm' | 'md';
}): JSX.Element {
  const typed = asEligibilityStatus(status);
  if (!typed) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 font-medium text-muted ${
          size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        }`}
      >
        <span aria-hidden>–</span>
        Not analysed
      </span>
    );
  }
  const meta = STATUS_META[typed];
  return (
    <span
      data-status={typed}
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${meta.className} ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <span aria-hidden>{meta.glyph}</span>
      {meta.label.toUpperCase()}
    </span>
  );
}

const OUTCOME_GLYPH: Record<CheckOutcome, string> = {
  MATCH: '✓',
  PARTIAL: '~',
  MISMATCH: '✕',
  UNKNOWN: '?',
};

const OUTCOME_WORD: Record<CheckOutcome, string> = {
  MATCH: 'Met',
  PARTIAL: 'Partly met',
  MISMATCH: 'Not met',
  UNKNOWN: 'Unknown',
};

function CheckRow({ check }: { check: EligibilityCheck }): JSX.Element {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
          check.outcome === 'MATCH'
            ? 'border-eligible/40 bg-eligible-soft text-eligible'
            : check.outcome === 'MISMATCH'
              ? 'border-ineligible/40 bg-ineligible-soft text-ineligible'
              : check.outcome === 'PARTIAL'
                ? 'border-uncertain/40 bg-uncertain-soft text-uncertain'
                : 'border-line-strong bg-surface-2 text-muted'
        }`}
      >
        {OUTCOME_GLYPH[check.outcome]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {check.label}
          <span className="sr-only"> — {OUTCOME_WORD[check.outcome]}</span>
          {check.mandatory ? (
            <span className="ml-2 rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Required
            </span>
          ) : null}
        </p>
        {check.detail ? <p className="mt-0.5 text-sm text-muted">{check.detail}</p> : null}
        {check.evidence ? (
          <p className="mt-1 border-l-2 border-line pl-2 text-xs italic text-muted">{check.evidence}</p>
        ) : null}
      </div>
    </li>
  );
}

/** Groups the server's checks by outcome, preserving its own labels. */
function group(checks: EligibilityCheck[], outcome: CheckOutcome): EligibilityCheck[] {
  return checks.filter((c) => c.outcome === outcome);
}

export function EligibilityPanel({
  eligibility,
}: {
  eligibility: EligibilityResult | null;
}): JSX.Element {
  if (!eligibility) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Eligibility analysis</h2>
        <p className="mt-2 text-sm text-muted">
          This job has not been analysed yet. Complete your profile, then re-analyse to see a verdict.
        </p>
      </section>
    );
  }

  const status: EligibilityStatus = eligibility.status;
  const met = group(eligibility.checks, 'MATCH');
  const notMet = group(eligibility.checks, 'MISMATCH');
  const unknown = group(eligibility.checks, 'UNKNOWN');
  const partial = group(eligibility.checks, 'PARTIAL');

  return (
    <section className="card p-4" aria-label="Eligibility analysis">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h2 className="text-sm font-semibold">Eligibility</h2>
          <p className="mt-0.5 text-xs text-muted">Decided by the server rule engine ({eligibility.engine})</p>
        </div>
        <EligibilityBadge status={status} />
      </header>

      <p className="mt-3 text-sm text-ink-2">{eligibility.explanation}</p>

      <div className="mt-4 space-y-4">
        {met.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-eligible">Requirements met</h3>
            <ul className="mt-1 divide-y divide-line">
              {met.map((c) => (
                <CheckRow key={`${c.factor}-${c.label}`} check={c} />
              ))}
            </ul>
          </div>
        ) : null}

        {partial.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-uncertain">Partly met</h3>
            <ul className="mt-1 divide-y divide-line">
              {partial.map((c) => (
                <CheckRow key={`${c.factor}-${c.label}`} check={c} />
              ))}
            </ul>
          </div>
        ) : null}

        {notMet.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ineligible">Requirements not met</h3>
            <ul className="mt-1 divide-y divide-line">
              {notMet.map((c) => (
                <CheckRow key={`${c.factor}-${c.label}`} check={c} />
              ))}
            </ul>
          </div>
        ) : null}

        {unknown.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Unknown</h3>
            <ul className="mt-1 divide-y divide-line">
              {unknown.map((c) => (
                <CheckRow key={`${c.factor}-${c.label}`} check={c} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {eligibility.missingInformation.length ? (
        <div className="mt-4 rounded-md border border-line bg-surface-2 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Missing information</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {eligibility.missingInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {eligibility.concerns.length ? (
        <div className="mt-3 rounded-md border border-uncertain/30 bg-uncertain-soft p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-uncertain">Worth checking</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {eligibility.concerns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
