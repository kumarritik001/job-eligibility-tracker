/**
 * Data hooks. One per backend resource, each a thin wrapper over useResource so
 * components never call `api.*` directly.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { useResource } from './useResource';
import type {
  Company,
  CompanyDetailResponse,
  DashboardResponse,
  JobDetailResponse,
  JobListResponse,
  JobQueryInput,
  NotificationListResponse,
  ProfileResponse,
  ResearchRun,
  ResearchStartResponse,
  ResearchStatusResponse,
} from '../types/api';
import { useAuth } from './useAuth';

// --- Dashboard --------------------------------------------------------------

export function useDashboard(enabled: boolean) {
  return useResource<DashboardResponse>((signal) => api.dashboard(signal), [], { enabled });
}

// --- Companies --------------------------------------------------------------

export function useCompanies(enabled: boolean) {
  return useResource<{ companies: Company[] }>((signal) => api.companies(signal), [], { enabled });
}

export function useCompany(id: string | undefined) {
  return useResource<CompanyDetailResponse>((signal) => api.company(id as string, signal), [id], {
    enabled: Boolean(id),
  });
}

/**
 * Add a company, then kick off research. The backend resolves the careers URL
 * during creation, so this is the "Add & Research" flow in two real calls.
 */
export function useAddCompany() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ company: Company; created: boolean } | null>(null);

  const add = useCallback(async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createCompany({ name });
      setCreated(res);
      await api.startResearch(res.company.id);
      return res;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not add that company.'));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { add, busy, error, created, reset: () => { setError(null); setCreated(null); } };
}

export function useRemoveCompany() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const remove = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.deleteCompany(id);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not remove that company.'));
      return false;
    } finally {
      setBusyId(null);
    }
  }, []);

  return { remove, busyId, error };
}

// --- Jobs -------------------------------------------------------------------

export function useJobs(query: JobQueryInput, enabled: boolean) {
  // The query object is flattened so the effect keys on its values, not identity.
  const key = JSON.stringify(query);
  return useResource<JobListResponse>((signal) => api.jobs(query, signal), [key], { enabled });
}

export function useJob(id: string | undefined) {
  return useResource<JobDetailResponse>((signal) => api.job(id as string, signal), [id], { enabled: Boolean(id) });
}

// --- Research ---------------------------------------------------------------

export type ResearchPhase = 'idle' | 'starting' | 'running' | 'succeeded' | 'failed';

export interface ResearchProgress {
  phase: ResearchPhase;
  runId: string | null;
  run: ResearchRun | null;
  steps: ResearchStatusResponse['live'] extends null ? never : NonNullable<ResearchStatusResponse['live']>['steps'];
  error: ApiError | null;
}

/**
 * Drives a research run to completion.
 *
 * Progress is shown from the server's own ResearchStep states. The backend has
 * no percentage, so none is invented here -- the indicator stays indeterminate
 * and lists the real steps.
 */
export function useResearch(companyId: string | undefined, onDone?: () => void) {
  const [phase, setPhase] = useState<ResearchPhase>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [steps, setSteps] = useState<NonNullable<ResearchStatusResponse['live']>['steps']>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const POLL_MS = 1200;

  useEffect(() => {
    if (phase !== 'running' || !runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      try {
        const res = await api.researchStatus(runId);
        if (!active) return;
        if (res.live) setSteps(res.live.steps);
        if (res.run) {
          setRun(res.run);
          if (res.run.status === 'COMPLETED') {
            setPhase('succeeded');
            onDone?.();
            return;
          }
          if (res.run.status === 'FAILED') {
            setPhase('failed');
            // A failed run must not imply data loss; the previous verified jobs
            // are still on the server and the message says so.
            setError(new ApiError('server', 0, res.run.errorMessage ?? 'Research failed.'));
            return;
          }
        } else if (res.live && !res.live.running) {
          // The run row can lag the in-memory state; give it one more tick.
          confirmTimer = setTimeout(() => {
            if (active) setPhase((p) => (p === 'running' ? 'succeeded' : p));
          }, POLL_MS);
        }
      } catch {
        /* transient poll failure; the next tick retries */
      }
      if (active) timer = setTimeout(() => void poll(), POLL_MS);
    };

    // Poll straight away so the first step appears immediately rather than
    // after a full interval of staring at a spinner.
    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (confirmTimer) clearTimeout(confirmTimer);
    };
  }, [phase, runId, onDone]);

  const start = useCallback(
    async (id?: string) => {
      // Accept an explicit id: callers that set the id in the same click (the
      // company list) would otherwise invoke a closure from the previous
      // render, where the id was still undefined.
      const target = id ?? companyId;
      if (!target) return;
      setPhase('starting');
      setError(null);
      setRun(null);
      setSteps([]);
      try {
        const res: ResearchStartResponse = await api.startResearch(target);
        setRunId(res.runId);
        setPhase('running');
      } catch (err) {
        setPhase('failed');
        setError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not start research.'));
      }
    },
    [companyId],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setRunId(null);
    setRun(null);
    setSteps([]);
    setError(null);
  }, []);

  return { phase, runId, run, steps, error, start, reset, busy: phase === 'starting' || phase === 'running' };
}

// --- Profile ----------------------------------------------------------------

export function useProfile(enabled: boolean) {
  const resource = useResource<ProfileResponse>((signal) => api.profile(signal), [], { enabled });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await api.saveProfile(patch);
        resource.setData(res);
        setSavedAt(Date.now());
        return res;
      } catch (err) {
        setSaveError(err instanceof ApiError ? err : new ApiError('server', 0, 'Could not save your profile.'));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [resource],
  );

  return { ...resource, save, saving, saveError, savedAt };
}

// --- Notifications ----------------------------------------------------------

export function useNotifications(enabled: boolean) {
  const resource = useResource<NotificationListResponse>((signal) => api.notifications(50, signal), [], { enabled });

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      try {
        await api.markNotificationsRead(ids);
        // Update in place so the badge does not flicker back to its old value.
        resource.setData((prev) =>
          prev
            ? {
                ...prev,
                notifications: prev.notifications.map((n) =>
                  ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
                ),
                unread: Math.max(0, prev.unread - ids.length),
              }
            : prev,
        );
      } catch {
        /* the next poll reconciles */
      }
    },
    [resource],
  );

  return { ...resource, markRead };
}

/** Unread badge for the sidebar; polls while the app is open. */
export function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const { status } = useAuth();

  useEffect(() => {
    if (!enabled || status !== 'authenticated') {
      setCount(0);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const res = await api.notifications(1);
        if (active) setCount(res.unread);
      } catch {
        /* badge is best-effort */
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, status]);

  return count;
}
