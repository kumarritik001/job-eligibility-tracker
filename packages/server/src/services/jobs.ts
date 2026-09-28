/**
 * Background research jobs.
 *
 * A research run takes several seconds of network time, so the API returns a
 * run id immediately and the client polls /api/research/:runId. This also gives
 * us one place that guarantees two runs for the same company never overlap,
 * which is what keeps a manual refresh and a scheduled refresh from racing.
 */

import type { ResearchStep } from '@jet/shared';
import { getCompany } from './store.js';
import { createResearchRun, getRun } from './runs.js';
import { researchCompany } from '../research/orchestrator.js';

interface Live {
  runId: string;
  userId: string;
  companyId: string;
  steps: ResearchStep[];
  startedAt: number;
}

const live = new Map<string, Live>();

/** Keyed by `${userId}:${companyId}`. */
const active = new Map<string, string>();

const MAX_STEPS = 64;

export function inFlight(userId: string, companyId: string): string | null {
  return active.get(`${userId}:${companyId}`) ?? null;
}

export function researchStatus(runId: string): { running: boolean; steps: ResearchStep[] } | null {
  const entry = live.get(runId);
  if (!entry) return null;
  return { running: true, steps: entry.steps };
}

export function startResearch(userId: string, companyId: string, careersUrl: string | null): string {
  const key = `${userId}:${companyId}`;
  const already = active.get(key);
  if (already) return already;

  const company = getCompany(userId, companyId);
  if (!company) throw new Error('Company not found');

  // The run row is created up front so the client can poll a real id from the
  // first response instead of guessing at one.
  const runId = createResearchRun(company.id, userId);
  active.set(key, runId);
  live.set(runId, { runId, userId, companyId, steps: [], startedAt: Date.now() });

  void (async () => {
    const entry = live.get(runId);
    try {
      const summary = await researchCompany(
        company,
        (step) => {
          if (!entry) return;
          const idx = entry.steps.findIndex((s) => s.key === step.key);
          if (idx >= 0) entry.steps[idx] = { ...entry.steps[idx], ...step };
          else entry.steps.push(step);
          if (entry.steps.length > MAX_STEPS) entry.steps.splice(0, entry.steps.length - MAX_STEPS);
        },
        careersUrl,
        runId,
      );
      if (summary.error) console.warn(`[research] ${company.name} failed: ${summary.error}`);
    } catch (err) {
      console.error('[research] unexpected failure:', err);
    } finally {
      // Keep the step list around briefly so a client that polls late can still
      // render the final state instead of an empty screen.
      setTimeout(() => live.delete(runId), 5 * 60_000).unref?.();
      if (active.get(key) === runId) active.delete(key);
    }
  })();

  return runId;
}

/** Blocking variant used by the scheduler and the CLI. */
export async function runResearchNow(userId: string, companyId: string, careersUrl: string | null = null) {
  const company = getCompany(userId, companyId);
  if (!company) throw new Error('Company not found');
  const summary = await researchCompany(company, () => undefined, careersUrl);
  active.delete(`${userId}:${companyId}`);
  return summary;
}

export function liveRunCount(): number {
  return active.size;
}
