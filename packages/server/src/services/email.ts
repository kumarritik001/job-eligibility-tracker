/**
 * Email delivery.
 *
 * Resend only, and only when RESEND_API_KEY is set. Delivery is opt-in per
 * user; nothing is sent until a user turns it on and confirms an address.
 * A failed send is logged and returns false rather than retrying silently, so
 * the caller can report "not delivered" instead of implying success.
 */

import { config } from '../config.js';
import { queryJobs } from './store.js';
import { all } from '../db/index.js';

interface ResendResponse {
  id?: string;
  message?: string;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: ResendResponse }> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.email.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  let data: ResendResponse = {};
  try {
    data = (await res.json()) as ResendResponse;
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

/** Eligible jobs closing within `days`, newest first. */
function digestRows(userId: string, days: number) {
  return queryJobs(userId, { status: 'ELIGIBLE', limit: 25, sort: 'DEADLINE_SOONEST' }).items.filter((j) => {
    if (!j.closingAt) return true;
    const ms = Date.parse(j.closingAt) - Date.now();
    return ms <= days * 86_400_000;
  });
}

function renderHtml(subject: string, rows: ReturnType<typeof digestRows>): string {
  const items = rows
    .map(
      (j) => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(j.title)}</strong><br>
        <span style="color:#475569;font-size:13px">${escapeHtml(j.companyName)}${j.location ? ` — ${escapeHtml(j.location)}` : ''}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;white-space:nowrap">
        ${j.closingAt ? `Closes ${j.closingAt.slice(0, 10)}` : 'No closing date stated'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;white-space:nowrap">
        ${j.matchScore === null ? '—' : `${j.matchScore}% match`}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px">
        <a href="${escapeHtml(j.sourceUrl)}">Original posting</a></td>
    </tr>`,
    )
    .join('');

  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a">
  <h2 style="margin:0 0 4px">${escapeHtml(subject)}</h2>
  <p style="color:#475569;font-size:13px;margin:0 0 16px">
    ${rows.length} source-verified opening${rows.length === 1 ? '' : 's'} match your profile. Match score is informational;
    mandatory requirements decide the verdict.
  </p>
  <table style="border-collapse:collapse;width:100%">${items}</table>
  <p style="color:#94a3b8;font-size:11px;margin-top:24px">
    Every link is the original source. Where a posting does not state a date, this email says so rather than estimating.
  </p>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export async function sendEligibleDigest(userId: string, to: string | null, days = 7): Promise<boolean> {
  if (!config.email.resendKey) return false;
  if (!to) return false;

  const rows = digestRows(userId, days);
  if (rows.length === 0) {
    // Nothing to say is a valid outcome; do not manufacture a "no results" email.
    return true;
  }

  const subject = `${rows.length} verified opening${rows.length === 1 ? '' : 's'} match your profile`;
  const { ok, status, data } = await post('/emails', {
    from: config.email.from,
    to: [to],
    subject,
    html: renderHtml(subject, rows),
    text: [
      subject,
      '',
      ...rows.map(
        (j) =>
          `- ${j.title} — ${j.companyName}${j.location ? ` (${j.location})` : ''}\n  ${j.sourceUrl}\n  ${
            j.closingAt ? `Closes ${j.closingAt.slice(0, 10)}` : 'No closing date stated in posting'
          }`,
      ),
    ].join('\n'),
    tags: [{ name: 'kind', value: 'eligible-digest' }],
  });

  if (!ok) {
    console.error(`[email] Resend rejected the message (${status}): ${data.message ?? 'unknown error'}`);
    return false;
  }
  return true;
}

/** Send for every opted-in user whose DAILY/WEEKLY digest is due. */
export async function sendScheduledDigests(): Promise<{ attempted: number; sent: number }> {
  const due = all<Record<string, any>>(
    `SELECT p.user_id, p.frequency, COALESCE(p.email, u.email) AS email
     FROM email_preferences p JOIN users u ON u.id = p.user_id
     WHERE p.enabled = 1 AND p.frequency IN ('DAILY', 'WEEKLY')
       AND (p.email IS NOT NULL OR u.email IS NOT NULL)`,
  );

  let sent = 0;
  for (const row of due) {
    const last = all<{ created_at: string }>(
      `SELECT created_at FROM notifications WHERE user_id = ? AND kind = 'NEW_ELIGIBLE_JOB' ORDER BY created_at DESC LIMIT 1`,
      [row.user_id],
    )[0];
    const intervalMs = row.frequency === 'DAILY' ? 86_400_000 : 7 * 86_400_000;
    if (last && Date.now() - Date.parse(last.created_at) < intervalMs) continue;

    const ok = await sendEligibleDigest(row.user_id, row.email, row.frequency === 'DAILY' ? 3 : 14);
    if (ok) sent += 1;
  }
  return { attempted: due.length, sent };
}
