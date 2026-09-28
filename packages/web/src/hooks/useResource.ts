/**
 * One async-data primitive for the whole app.
 *
 * Guarantees the four states the UI depends on: loading, success (with data),
 * empty (success but nothing to show), and error. Pages never hand-roll their
 * own flags, so they cannot forget one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ErrorKind } from '../api/client';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** Success, but the caller decides the list is empty. */
  refetch: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

export interface ResourceOptions {
  /** When false the request is not issued (e.g. no id yet). */
  enabled?: boolean;
}

export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: ResourceOptions = {},
): ResourceState<T> {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if ((err as Error)?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError('server', 0, 'Something went wrong. Please try again.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const update = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setData((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  return { data, loading, error, refetch, setData: update };
}

/** Human-readable text for any failure, including network errors. */
export function messageForError(error: ApiError | null): string {
  if (!error) return '';
  if (error.kind === 'not_found') return error.message;
  return error.message;
}

export function isAuthError(error: ApiError | null): boolean {
  return error?.kind === ('unauthorized' satisfies ErrorKind);
}
