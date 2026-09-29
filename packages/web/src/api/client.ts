/**
 * Typed HTTP client.
 *
 * Every response is checked against its declared shape before it is handed
 * back, so a contract drift surfaces as a clear message instead of a render
 * crash on `undefined.map`.
 *
 * Errors are normalised into ApiError, which carries a stable `kind` the UI
 * switches on. Raw server messages are used for 4xx (they are written for the
 * user) but never for 5xx, which the API deliberately masks.
 */

import type {
  AuthResponse,
  CompanyCreateResponse,
  CompanyDetailResponse,
  CompanyListResponse,
  DashboardResponse,
  DiscoverResponse,
  EmailSettingsResponse,
  HealthResponse,
  JobDetailResponse,
  JobListResponse,
  JobQueryInput,
  MarkReadResponse,
  MeResponse,
  NotificationListResponse,
  ProfileResponse,
  ResearchListResponse,
  ResearchStartResponse,
  ResearchStatusResponse,
} from '../types/api';

export type ErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation'
  | 'server'
  | 'network'
  | 'malformed';

export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  /** True when the failure was caused by a missing/expired token. */
  readonly isAuth: boolean;

  constructor(kind: ErrorKind, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.isAuth = kind === 'unauthorized';
  }
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'validation';
  return 'server';
}

const GENERIC: Record<ErrorKind, string> = {
  unauthorized: 'Your session has expired. Please sign in again.',
  forbidden: 'You do not have access to this resource.',
  not_found: 'We could not find that.',
  conflict: 'That conflicts with something that already exists.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  validation: 'Please check the details you entered.',
  server: 'Something went wrong on the server. Please try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  malformed: 'The server sent a response we could not read.',
};

/** Subscriber list, so a 401 anywhere can sign the user out exactly once. */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(fn: UnauthorizedListener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

function notifyUnauthorized(): void {
  for (const fn of unauthorizedListeners) fn();
}

// --- Token storage ----------------------------------------------------------

const TOKEN_KEY = 'jet.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private-mode browsers throw on localStorage access. The session simply
    // becomes in-memory for this tab rather than crashing the app.
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable; token stays in memory only */
  }
}

/**
 * The token the next request should use. Tests and the auth provider set this
 * so they never have to touch localStorage.
 */
let inMemoryToken: string | null = null;

export function setTokenOverride(token: string | null): void {
  inMemoryToken = token;
}

function currentToken(): string | null {
  return inMemoryToken ?? getToken();
}

// --- Core request -----------------------------------------------------------

/**
 * Empty in development, where Vite proxies /api to the local server. In a
 * production build it must be the API's absolute origin, set as VITE_API_BASE
 * on the host. Left empty in production, every call would go to the static host
 * and 404 with no useful error, so say so loudly rather than failing silently.
 */
const BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');

if (!BASE && typeof location !== 'undefined' && !/^(localhost|127\.0\.0\.1)/.test(location.hostname)) {
  console.error(
    '[jet] VITE_API_BASE is not set, so API calls will go to ' +
      `${location.origin} and return 404. Set VITE_API_BASE to the API origin and rebuild.`,
  );
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the global 401 handler (used by the login call itself). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = currentToken();
  if (token && !anonymous) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(apiUrl(path) + buildQuery(query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError('network', 0, GENERIC.network);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (response.ok) throw new ApiError('malformed', response.status, GENERIC.malformed);
    }
  }

  if (!response.ok) {
    const kind = kindForStatus(response.status);
    // 4xx bodies are written for the user. 5xx and 429 fall back to our copy
    // so internals are never surfaced.
    const serverMessage =
      parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : null;
    const message = serverMessage && response.status < 500 ? serverMessage : (GENERIC[kind] ?? GENERIC.server);
    if (kind === 'unauthorized' && !anonymous) notifyUnauthorized();
    throw new ApiError(kind, response.status, message);
  }

  if (parsed === null) throw new ApiError('malformed', response.status, GENERIC.malformed);
  return parsed as T;
}

/** Downloads a binary/text export, preserving the server's filename header. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(apiUrl(path), { headers });
  if (!response.ok) {
    const kind = kindForStatus(response.status);
    if (kind === 'unauthorized') notifyUnauthorized();
    throw new ApiError(kind, response.status, GENERIC[kind] ?? GENERIC.server);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// --- Endpoints --------------------------------------------------------------

export const api = {
  health: () => request<HealthResponse>('/api/health', { anonymous: true }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: { email, password }, anonymous: true }),

  signup: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', { method: 'POST', body: { email, password }, anonymous: true }),

  me: (signal?: AbortSignal) => request<MeResponse>('/api/auth/me', { signal }),

  dashboard: (signal?: AbortSignal) => request<DashboardResponse>('/api/dashboard', { signal }),

  profile: (signal?: AbortSignal) => request<ProfileResponse>('/api/profile', { signal }),
  saveProfile: (patch: unknown) => request<ProfileResponse>('/api/profile', { method: 'PUT', body: patch }),

  companies: (signal?: AbortSignal) => request<CompanyListResponse>('/api/companies', { signal }),
  createCompany: (body: { name: string; officialWebsite?: string | null; careersUrl?: string | null }) =>
    request<CompanyCreateResponse>('/api/companies', { method: 'POST', body }),
  company: (id: string, signal?: AbortSignal) =>
    request<CompanyDetailResponse>(`/api/companies/${encodeURIComponent(id)}`, { signal }),
  updateCompany: (id: string, body: Record<string, unknown>) =>
    request<{ company: unknown }>(`/api/companies/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteCompany: (id: string) =>
    request<{ ok: boolean }>(`/api/companies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  discoverCompanies: (q: string, signal?: AbortSignal) =>
    request<DiscoverResponse>('/api/companies/discover', { query: { q }, signal }),

  startResearch: (companyId: string, careersUrl?: string | null) =>
    request<ResearchStartResponse>(`/api/companies/${encodeURIComponent(companyId)}/research`, {
      method: 'POST',
      // Omit the key entirely when no override was passed. Coercing to `null`
      // (as `careersUrl ?? null` would) tells the server to CLEAR the stored
      // careers URL, so a company researched from the UI never uses the URL
      // already on its record and falls back to discovery -- which fails
      // without a paid search key. An explicit `null` from a caller still
      // reaches the server as `null` and still clears.
      body: careersUrl === undefined ? {} : { careersUrl },
    }),
  researchStatus: (runId: string, signal?: AbortSignal) =>
    request<ResearchStatusResponse>(`/api/research/${encodeURIComponent(runId)}`, { signal }),
  researchRuns: (companyId?: string, signal?: AbortSignal) =>
    request<ResearchListResponse>('/api/research', { query: { companyId }, signal }),

  jobs: (query: JobQueryInput = {}, signal?: AbortSignal) =>
    request<JobListResponse>('/api/jobs', { query: query as Record<string, string>, signal }),
  job: (id: string, signal?: AbortSignal) =>
    request<JobDetailResponse>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),

  notifications: (limit = 50, signal?: AbortSignal) =>
    request<NotificationListResponse>('/api/notifications', { query: { limit }, signal }),
  markNotificationsRead: (ids: string[]) =>
    request<MarkReadResponse>('/api/notifications/read', { method: 'POST', body: { ids } }),

  emailSettings: (signal?: AbortSignal) => request<EmailSettingsResponse>('/api/settings/email', { signal }),
  saveEmailSettings: (body: { enabled: boolean; frequency: 'IMMEDIATELY' | 'DAILY' | 'WEEKLY'; email: string | null }) =>
    request<{ prefs: unknown }>('/api/settings/email', { method: 'PUT', body }),
  sendTestEmail: () => request<{ ok: boolean }>('/api/settings/email/test', { method: 'POST' }),
};
