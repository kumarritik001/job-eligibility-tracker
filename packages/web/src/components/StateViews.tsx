/**
 * The four async states every data-backed view needs. Centralised so no page
 * can accidentally render a blank area while a request is in flight.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw, WifiOff } from 'lucide-react';
import type { ApiError, ErrorKind } from '../api/client';

export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }): JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card p-4">
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton mt-2.5 h-3 w-2/3" />
          <div className="skeleton mt-2 h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-muted">
      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

const ERROR_STYLE: Record<ErrorKind, { icon: typeof AlertTriangle; title: string; tone: string }> = {
  unauthorized: { icon: Lock, title: 'Sign in required', tone: 'text-uncertain border-uncertain/40 bg-uncertain-soft' },
  forbidden: { icon: Lock, title: 'Not permitted', tone: 'text-ineligible border-ineligible/40 bg-ineligible-soft' },
  not_found: { icon: Inbox, title: 'Not found', tone: 'text-ink-2 border-line-strong bg-surface-2' },
  conflict: { icon: AlertTriangle, title: 'Conflict', tone: 'text-uncertain border-uncertain/40 bg-uncertain-soft' },
  rate_limited: { icon: AlertTriangle, title: 'Slow down', tone: 'text-uncertain border-uncertain/40 bg-uncertain-soft' },
  validation: { icon: AlertTriangle, title: 'Check the details', tone: 'text-uncertain border-uncertain/40 bg-uncertain-soft' },
  server: { icon: AlertTriangle, title: 'Server error', tone: 'text-ineligible border-ineligible/40 bg-ineligible-soft' },
  network: { icon: WifiOff, title: 'No connection', tone: 'text-ink-2 border-line-strong bg-surface-2' },
  malformed: { icon: AlertTriangle, title: 'Unexpected response', tone: 'text-ink-2 border-line-strong bg-surface-2' },
};

export function ErrorState({
  error,
  onRetry,
  children,
}: {
  error: ApiError;
  onRetry?: () => void;
  children?: ReactNode;
}): JSX.Element {
  const style = ERROR_STYLE[error.kind] ?? ERROR_STYLE.server;
  const Icon = style.icon;
  return (
    <div role="alert" className={`card border p-4 ${style.tone}`}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{style.title}</h3>
          <p className="mt-1 text-sm break-words">{error.message}</p>
          {children}
        </div>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-secondary mt-3">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="card flex flex-col items-center gap-2 border-dashed p-10 text-center">
      <Inbox aria-hidden className="h-6 w-6 text-muted" />
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Renders the correct state for a resource. `isEmpty` lets a caller declare
 * that a successful response has nothing to show.
 */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  onRetry,
  loadingRows,
  empty,
  children,
}: {
  loading: boolean;
  error: ApiError | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  loadingRows?: number;
  empty?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  if (loading) return <LoadingState rows={loadingRows} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}
