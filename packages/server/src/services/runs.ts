/**
 * Research run bookkeeping. Runs are persisted so the UI can show history and
 * a failed run stays inspectable after the fact.
 */

import type { ResearchRun, ResearchRunStatus, ResearchStep } from '@jet/shared';
import { all, nowIso, one, run as exec, str, toArray, uid } from '../db/index.js';

export function createResearchRun(companyId: string, userId: string): string {
  const id = uid();
  exec(`INSERT INTO research_runs (id, company_id, user_id, status, started_at) VALUES (?,?,?,'RUNNING',?)`, [
    id, companyId, userId, nowIso(),
  ]);
  return id;
}

/** Upsert one step so a client polling progress sees the current state. */
export function recordStep(runId: string, step: ResearchStep): void {
  const row = one<{ steps: string }>(`SELECT steps FROM research_runs WHERE id = ?`, [runId]);
  const steps: ResearchStep[] = toArray<ResearchStep>(row?.steps);
  const idx = steps.findIndex((s) => s.key === step.key);
  if (idx >= 0) steps[idx] = { ...steps[idx], ...step };
  else steps.push(step);
  exec(`UPDATE research_runs SET steps = ? WHERE id = ?`, [JSON.stringify(steps), runId]);
}

export function finishResearchRun(
  runId: string,
  summary: {
    status: ResearchRunStatus;
    jobsFound: number;
    jobsNew: number;
    jobsUpdated: number;
    jobsRemoved: number;
    eligibleJobs: number;
    sourcesTried: string[];
    sourcesOk: string[];
    errorMessage: string | null;
  },
): void {
  exec(
    `UPDATE research_runs SET status = ?, completed_at = ?, jobs_found = ?, jobs_new = ?, jobs_updated = ?,
       jobs_removed = ?, eligible_jobs = ?, sources_tried = ?, sources_ok = ?, error_message = ? WHERE id = ?`,
    [
      summary.status, nowIso(), summary.jobsFound, summary.jobsNew, summary.jobsUpdated,
      summary.jobsRemoved, summary.eligibleJobs, JSON.stringify(summary.sourcesTried),
      JSON.stringify(summary.sourcesOk), summary.errorMessage, runId,
    ],
  );
}

function mapRun(r: Record<string, any>): ResearchRun {
  return {
    id: r.id, companyId: r.company_id, userId: r.user_id, status: r.status,
    startedAt: r.started_at, completedAt: str(r.completed_at), jobsFound: r.jobs_found, jobsNew: r.jobs_new,
    jobsUpdated: r.jobs_updated, jobsRemoved: r.jobs_removed, eligibleJobs: r.eligible_jobs,
    sourcesTried: toArray(r.sources_tried), sourcesOk: toArray(r.sources_ok),
    errorMessage: str(r.error_message), steps: toArray<ResearchStep>(r.steps),
  };
}

export function listRuns(userId: string, companyId?: string, limit = 20): ResearchRun[] {
  if (companyId) {
    return all<Record<string, any>>(
      `SELECT * FROM research_runs WHERE user_id = ? AND company_id = ? ORDER BY started_at DESC LIMIT ?`,
      [userId, companyId, limit],
    ).map(mapRun);
  }
  return all<Record<string, any>>(
    `SELECT * FROM research_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
    [userId, limit],
  ).map(mapRun);
}

export function getRun(userId: string, runId: string): ResearchRun | null {
  const r = all<Record<string, any>>(`SELECT * FROM research_runs WHERE id = ? AND user_id = ?`, [runId, userId])[0];
  return r ? mapRun(r) : null;
}
