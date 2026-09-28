/**
 * Research status panel.
 *
 * The backend exposes ResearchStep states but no percentage, so this shows the
 * real step list and an indeterminate indicator. No fabricated progress.
 */

import { CheckCircle2, CircleDashed, Loader2, XCircle, Ban } from 'lucide-react';
import type { ResearchRun, ResearchStep } from '../types/api';
import type { ResearchPhase } from '../hooks/useData';
import { Spinner } from './StateViews';
import { relativeTime } from '../lib/format';

const STEP_ICON: Record<ResearchStep['state'], typeof CheckCircle2> = {
  done: CheckCircle2,
  running: Loader2,
  pending: CircleDashed,
  skipped: Ban,
  failed: XCircle,
};

const STEP_TONE: Record<ResearchStep['state'], string> = {
  done: 'text-eligible',
  running: 'text-brand',
  pending: 'text-muted',
  skipped: 'text-muted',
  failed: 'text-ineligible',
};

function StepList({ steps }: { steps: ResearchStep[] }): JSX.Element | null {
  if (!steps.length) return null;
  return (
    <ol className="mt-3 space-y-1.5" aria-live="polite">
      {steps.map((step) => {
        const Icon = STEP_ICON[step.state];
        return (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <Icon
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 ${STEP_TONE[step.state]} ${step.state === 'running' ? 'animate-spin' : ''}`}
            />
            <span className="min-w-0 flex-1">
              <span className={step.state === 'pending' ? 'text-muted' : 'text-ink-2'}>{step.label}</span>
              {step.detail ? <span className="block text-xs text-muted">{step.detail}</span> : null}
            </span>
            <span className="sr-only">{step.state}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ResearchPanel({
  phase,
  steps,
  run,
  onDismiss,
}: {
  phase: ResearchPhase;
  steps: ResearchStep[];
  run: ResearchRun | null;
  onDismiss?: () => void;
}): JSX.Element | null {
  if (phase === 'idle') return null;

  if (phase === 'starting' || phase === 'running') {
    return (
      <div className="card border-brand/30 bg-brand-soft/50 p-4" role="status" aria-live="polite">
        <div className="flex items-center gap-2">
          <Spinner label="Researching company…" />
        </div>
        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Research in progress"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
        </div>
        <p className="mt-2 text-xs text-muted">
          Progress is reported by the server as each step completes; there is no percentage.
        </p>
        <StepList steps={steps} />
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="card border-ineligible/30 bg-ineligible-soft p-4" role="alert">
        <h3 className="text-sm font-semibold text-ineligible">Research failed</h3>
        <p className="mt-1 text-sm text-ink-2">
          Research failed. Previous verified results have been preserved.
        </p>
        {run?.errorMessage ? <p className="mt-1.5 text-xs text-muted">{run.errorMessage}</p> : null}
        <StepList steps={steps} />
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="btn btn-secondary mt-3">
            Dismiss
          </button>
        ) : null}
      </div>
    );
  }

  // succeeded
  return (
    <div className="card border-eligible/30 bg-eligible-soft p-4" role="status" aria-live="polite">
      <h3 className="text-sm font-semibold text-eligible">Research completed</h3>
      {run ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Jobs found</dt>
            <dd className="font-semibold tabular-nums">{run.jobsFound}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">New jobs</dt>
            <dd className="font-semibold tabular-nums">{run.jobsNew}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Eligible jobs</dt>
            <dd className="font-semibold tabular-nums text-eligible">{run.eligibleJobs}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Finished</dt>
            <dd className="text-xs text-muted">{relativeTime(run.completedAt) ?? '—'}</dd>
          </div>
        </dl>
      ) : null}
      <StepList steps={steps} />
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="btn btn-secondary mt-3">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
