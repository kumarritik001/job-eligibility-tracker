/**
 * Error mapping and formatting helpers. These cover the status codes the UI
 * branches on, plus the filter rules mirrored from the server.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError, api, request } from '../api/client';
import { asEligibilityStatus, experienceLabel, linesToList, relativeTime } from '../lib/format';
import { experienceBucket, matchesPostedWindow } from '../lib/jobs';
import { installMockFetch, mockRoute, resetRoutes, signInFixture } from '../test/mockApi';
import { TEST_TOKEN, makeJob } from '../test/fixtures';

beforeEach(() => {
  resetRoutes();
  installMockFetch();
  // Signed in, so the mock's requireAuth gate lets the request reach the route
  // under test. The anonymous header check below uses a public endpoint.
  signInFixture();
});

async function expectKind(status: number, body: unknown, kind: string): Promise<void> {
  mockRoute('GET', '/api/dashboard', { status, body });
  await expect(api.dashboard()).rejects.toMatchObject({ kind, status });
}

describe('API error mapping', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [400, 'validation'],
    [500, 'server'],
  ])('maps HTTP %i to the %s kind', async (status, kind) => {
    await expectKind(status, { error: 'x' }, kind);
  });

  it('uses the server message for 4xx so the user sees the real reason', async () => {
    mockRoute('POST', '/api/auth/login', { status: 409, body: { error: 'An account with that email already exists.' } });
    await expect(api.login('a@b.com', 'password123')).rejects.toThrow('An account with that email already exists.');
  });

  it('never leaks a raw 5xx body to the user', async () => {
    mockRoute('GET', '/api/dashboard', { status: 500, body: { error: 'SQLITE_CONSTRAINT at /src/db/index.ts:71' } });
    await expect(api.dashboard()).rejects.toThrow('Something went wrong on the server. Please try again.');
  });

  it('reports a network failure distinctly from a server error', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const err = await api.dashboard().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('network');
  });

  it('sends the bearer token when one is set', async () => {
    mockRoute('GET', '/api/dashboard', { status: 200, body: { ok: true } });
    await request('/api/dashboard');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it('omits the Authorization header for anonymous calls', async () => {
    // /api/auth/login is a public endpoint, and `anonymous: true` means the
    // stored token is not attached even though one exists.
    mockRoute('POST', '/api/auth/login', { status: 200, body: { token: 't', user: { id: 'u', email: 'e' } } });
    await api.login('a@b.com', 'password123');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a malformed response rather than crashing the render', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;
    await expect(api.dashboard()).rejects.toMatchObject({ kind: 'malformed' });
  });
});

describe('formatting', () => {
  it('returns null for a missing date rather than "Invalid Date"', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime('not-a-date')).toBeNull();
  });

  it('produces a human relative time', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(relativeTime(twoHoursAgo)).toMatch(/hour/);
  });

  it('narrows the loosely-typed stored status', () => {
    expect(asEligibilityStatus('ELIGIBLE')).toBe('ELIGIBLE');
    expect(asEligibilityStatus('NONSENSE')).toBeNull();
    expect(asEligibilityStatus(null)).toBeNull();
  });

  it('formats experience ranges', () => {
    expect(experienceLabel(1, 3)).toBe('1–3 yrs');
    expect(experienceLabel(2, 2)).toBe('2 yr');
    expect(experienceLabel(3, null)).toBe('3+ yrs');
    expect(experienceLabel(null, null)).toBeNull();
  });

  it('turns newline text into a clean list', () => {
    expect(linesToList('Aspen\n\n  MATLAB  \n')).toEqual(['Aspen', 'MATLAB']);
  });
});

describe('filters mirror the server rules', () => {
  it('buckets experience exactly as store.ts does', () => {
    expect(experienceBucket({ experienceMin: null })).toBe('ENTRY');
    expect(experienceBucket({ experienceMin: 0 })).toBe('ENTRY');
    expect(experienceBucket({ experienceMin: 1 })).toBe('ENTRY');
    expect(experienceBucket({ experienceMin: 2 })).toBe('MID');
    expect(experienceBucket({ experienceMin: 4 })).toBe('MID');
    expect(experienceBucket({ experienceMin: 5 })).toBe('SENIOR');
  });

  it('treats a null posted date as "older", as the server does', () => {
    expect(matchesPostedWindow({ postedAt: null }, 'OLDER')).toBe(true);
    expect(matchesPostedWindow({ postedAt: null }, 'LAST_7_DAYS')).toBe(false);
    expect(matchesPostedWindow({ postedAt: new Date().toISOString() }, 'ANY')).toBe(true);
    expect(
      matchesPostedWindow({ postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }, 'LAST_7_DAYS'),
    ).toBe(true);
  });
});

describe('job fixtures stay in sync with the Job contract', () => {
  it('exposes the fields JobCard renders', () => {
    const job = makeJob();
    expect(job).toHaveProperty('sourceUrl');
    expect(job).toHaveProperty('eligibilityStatus');
    expect(job).toHaveProperty('lastVerifiedAt');
  });
});
