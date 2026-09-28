/**
 * Scheduled refresh.
 *
 * Companies with a refresh mode other than MANUAL are re-researched on their
 * cadence. A single tick researches at most a few companies so a slow source
 * can never block the event loop's other work or pile up concurrent crawls,
 * and a company that keeps failing backs off instead of being retried every
 * tick.
 */

import { config } from './config.js';
import { dueForRefresh } from './services/store.js';
import { runResearchNow } from './services/jobs.js';
import { sendScheduledDigests } from './services/email.js';
import { listUserIds } from './services/auth.js';

const MAX_PER_TICK = 2;
const BACKOFF_AFTER_FAILURES = 3;
const BACKOFF_MS = 6 * 3_600_000;

const failures = new Map<string, { count: number; until: number }>();

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due = dueForRefresh().filter((c) => {
      const f = failures.get(c.id);
      return !f || f.until <= now;
    });

    for (const company of due.slice(0, MAX_PER_TICK)) {
      try {
        const summary = await runResearchNow(company.userId, company.id, company.careersUrl);
        failures.delete(company.id);
        console.log(`[scheduler] ${company.name}: ${summary.jobsFound} found, ${summary.jobsNew} new, ${summary.error ?? 'ok'}`);
      } catch (err) {
        const f = failures.get(company.id) ?? { count: 0, until: 0 };
        f.count += 1;
        f.until = Date.now() + (f.count >= BACKOFF_AFTER_FAILURES ? BACKOFF_MS : 10 * 60_000);
        failures.set(company.id, f);
        console.error(`[scheduler] ${company.name} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (new Date().getHours() === 9) {
      const digests = await sendScheduledDigests();
      if (digests.attempted > 0) console.log(`[scheduler] digests: ${digests.sent}/${digests.attempted} sent`);
    }
  } catch (err) {
    console.error('[scheduler] tick failed:', err);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (!config.scheduler.enabled) {
    console.log('[scheduler] disabled (SCHEDULER_ENABLED=false)');
    return;
  }
  if (timer) return;
  console.log(`[scheduler] every ${config.scheduler.tickSeconds}s for ${listUserIds().length} user(s)`);
  timer = setInterval(() => void tick(), config.scheduler.tickSeconds * 1000);
  timer.unref();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { tick as runSchedulerTick };
