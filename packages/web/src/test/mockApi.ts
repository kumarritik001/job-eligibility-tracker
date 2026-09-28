/**
 * A tiny fake of the Fastify API for tests.
 *
 * Routes are matched on `METHOD /path` against the real endpoint list, so a
 * test that references an endpoint the server does not have fails loudly here
 * instead of silently rendering an empty screen.
 */

import { vi } from 'vitest';
import { setToken, setTokenOverride } from '../api/client';
import { TEST_TOKEN, TEST_USER } from './fixtures';

type Handler = (body: unknown) => unknown;

interface Route {
  status: number;
  /** Omitted when `sequence` supplies the body for every call. */
  body?: unknown;
  /** Per-call sequence, so a test can vary a response across polls. */
  sequence?: unknown[];
  /** Simulate the request never reaching the server. */
  networkError?: boolean;
}

const routes = new Map<string, Route | Handler>();
let callCounts = new Map<string, number>();

function key(method: string, path: string): string {
  return `${method} ${path}`;
}

export function mockRoute(method: string, path: string, route: Route | Handler): void {
  routes.set(key(method.toUpperCase(), path), route);
}

export function resetRoutes(): void {
  routes.clear();
  callCounts = new Map();
}

export function callCount(path: string): number {
  return callCounts.get(path) ?? 0;
}

/** Installs the fetch stub. Call from beforeEach in each test file. */
export function installMockFetch(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    const auth = new Headers(init?.headers).get('Authorization');

    const entry = routes.get(key(method, path));
    if (!entry) {
      return jsonResponse(404, { error: `No test route for ${method} ${path}` });
    }

    callCounts.set(path, (callCounts.get(path) ?? 0) + 1);

    // Any route other than the auth entry points requires a bearer token,
    // mirroring the server's requireAuth hook.
    const isPublic = path === '/api/auth/login' || path === '/api/auth/signup' || path === '/api/health';
    if (!isPublic && auth !== `Bearer ${TEST_TOKEN}`) {
      return jsonResponse(401, { error: 'Sign in to continue.' });
    }

    if (typeof entry === 'function') {
      const value = entry(init?.body ? JSON.parse(String(init.body)) : null);
      // A handler may be async, e.g. to hold a response open while the test
      // asserts the loading state.
      if (value instanceof Promise) return value.then((resolved) => jsonResponse(200, resolved));
      return jsonResponse(200, value);
    }

    if (entry.networkError) {
      throw new TypeError('Failed to fetch');
    }

    if (entry.sequence) {
      const index = (callCounts.get(path) ?? 1) - 1;
      const body = entry.sequence[Math.min(index, entry.sequence.length - 1)];
      return jsonResponse(entry.status, body);
    }
    return jsonResponse(entry.status, entry.body);
  }) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Puts the client into an authenticated state without calling the server. */
export function signInFixture(): void {
  setToken(TEST_TOKEN);
  setTokenOverride(TEST_TOKEN);
}

export const fixtureUser = TEST_USER;
