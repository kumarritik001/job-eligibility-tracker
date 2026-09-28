/** Runtime configuration. Secrets are read here and never reach the client. */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env before anything reads process.env. Real environment variables
// always win, so a deployment never depends on the file.
try {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFile);
  }
} catch {
  // A malformed .env should not stop the server from starting; the defaults
  // below are safe and /api/health reports what is actually configured.
}

function bool(name: string, dflt: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-to-a-long-random-string-before-deploying')) {
  throw new Error('JWT_SECRET must be set to a strong random value in production.');
}

/**
 * Browser origins allowed to call the API.
 *
 * The web app and the API are deployed separately (Vercel + a persistent-disk
 * host), so this is a list rather than a single value. It is comma-separated
 * because that is what a deploy host's env var field can hold on one line.
 */
function originList(): string[] {
  const raw = process.env.APP_ORIGIN ?? 'http://localhost:5173,http://localhost:4173';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const corsOrigins = originList();

/**
 * Vercel gives every preview deployment a unique subdomain, so they cannot be
 * enumerated. Opt in explicitly rather than accepting any *.vercel.app, which
 * would let any Vercel deployment read a signed-in user's API responses.
 */
const allowVercelPreviews = bool('APP_ORIGIN_ALLOW_VERCEL_PREVIEWS', false);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  port: int('PORT', 4000),

  /** Kept for the single-origin case and for /api/health reporting. */
  appOrigin: corsOrigins[0] ?? 'http://localhost:5173',
  corsOrigins,
  allowVercelPreviews,

  jwtSecret: process.env.JWT_SECRET ?? randomBytes(32).toString('hex'),

  databaseUrl: process.env.DATABASE_URL ?? 'file:./data/jet.db',

  auth: {
    mode: (process.env.AUTH_MODE ?? 'local') as 'local' | 'supabase',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  },

  search: {
    serper: process.env.SERPER_API_KEY ?? '',
    brave: process.env.BRAVE_API_KEY ?? '',
    tavily: process.env.TAVILY_API_KEY ?? '',
  },

  ai: {
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
    get enabled(): boolean {
      return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    },
  },

  email: {
    resendKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'Job Tracker <alerts@example.com>',
  },

  crawl: {
    userAgent: process.env.CRAWL_USER_AGENT ?? '',
    maxConcurrency: int('CRAWL_MAX_CONCURRENCY', 3),
    requestDelayMs: int('CRAWL_REQUEST_DELAY_MS', 1200),
    timeoutMs: int('CRAWL_TIMEOUT_MS', 20000),
    respectRobots: bool('CRAWL_RESPECT_ROBOTS_TXT', true),
    maxPagesPerCompany: int('CRAWL_MAX_PAGES_PER_COMPANY', 12),
  },

  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', !isProd),
    tickSeconds: int('SCHEDULER_TICK_SECONDS', 300),
  },
};

export type Config = typeof config;

/**
 * Builds the CORS decision function. Pure, so the allowlist logic can be
 * tested without reloading the module (config reads process.env once).
 *
 * Returns false for unknown origins so @fastify/cors omits the CORS headers and
 * the browser blocks the response, rather than reflecting an attacker-controlled
 * origin back.
 *
 * A missing Origin header means a same-origin request, curl, or a server-side
 * call. Those are not subject to CORS, so they pass through.
 */
export function createOriginChecker(origins: string[], allowVercelPreviews: boolean) {
  const allowed = new Set(origins);
  return (origin: string | undefined): boolean => {
    if (!origin) return true;
    if (allowed.has(origin)) return true;
    if (allowVercelPreviews && /^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i.test(origin)) return true;
    return false;
  };
}

export const isAllowedOrigin = createOriginChecker(corsOrigins, allowVercelPreviews);

/** Which optional integrations are actually configured. Surfaced in /api/health. */
export function capabilities() {
  return {
    searchProvider: config.search.serper
      ? 'serper'
      : config.search.brave
        ? 'brave'
        : config.search.tavily
          ? 'tavily'
          : null,
    ai: config.ai.enabled ? (config.ai.anthropicKey ? 'anthropic' : 'openai') : null,
    email: Boolean(config.email.resendKey),
    scheduler: config.scheduler.enabled,
    database: 'node:sqlite (development) — see supabase/schema.sql for PostgreSQL',
  };
}
