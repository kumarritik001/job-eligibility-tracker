/**
 * Authentication.
 *
 * Local mode (default): email + password, hashed with scrypt. No third-party
 * account store, nothing leaves the machine.
 *
 * Supabase mode: the client sends the access token issued by Supabase Auth and
 * we verify its signature and claims against the Supabase JWT secret, so the
 * same API works without a code change on the client.
 *
 * Every request resolves to a row in `users`. A Supabase user's first request
 * provisions the local mirror row, which is what all other tables key off.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { all, nowIso, one, run, uid } from '../db/index.js';
import { config } from '../config.js';

/**
 * scrypt parameters, kept in the hash string so parameters can be raised later
 * without invalidating existing passwords.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };

/** scrypt needs headroom above the default 32MB for N=16384. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** promisify only captures the 3-arg overload, so the options form is wrapped. */
function deriveKey(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const opts: ScryptOptions = { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: SCRYPT_MAXMEM };
  const key = await deriveKey(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, opts);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const opts: ScryptOptions = { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: SCRYPT_MAXMEM };
  const actual = await deriveKey(password.normalize('NFKC'), salt, expected.length, opts);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

function mapUser(row: Record<string, any>): UserRecord {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function findUserByEmail(email: string): UserRecord | null {
  const row = one<Record<string, any>>(`SELECT * FROM users WHERE email = ?`, [email.trim().toLowerCase()]);
  return row ? mapUser(row) : null;
}

export function findUserById(id: string): UserRecord | null {
  const row = one<Record<string, any>>(`SELECT * FROM users WHERE id = ?`, [id]);
  return row ? mapUser(row) : null;
}

export function createUser(email: string, passwordHash: string): UserRecord {
  const id = uid();
  const at = nowIso();
  const normalized = email.trim().toLowerCase();
  run(`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [
    id, normalized, passwordHash, at, at,
  ]);
  return { id, email: normalized, passwordHash, createdAt: at };
}

/** A new user always gets a profile row, even if empty, so the UI can edit it. */
export function ensureProfileRow(userId: string): void {
  const existing = one(`SELECT user_id FROM user_profiles WHERE user_id = ?`, [userId]);
  if (existing) return;
  run(`INSERT INTO user_profiles (user_id, name, degree, branch, graduation_year, updated_at) VALUES (?,'','','',NULL,?)`, [
    userId, nowIso(),
  ]);
}

// ---------------------------------------------------------------------------
// Supabase token verification
// ---------------------------------------------------------------------------

interface SupabaseClaims {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
  aud?: string;
  iss?: string;
}

function b64urlToBuf(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a Supabase HS256 JWT using the project's JWT secret. Returns the
 * claims, or null when the token is malformed, unsigned, expired, or not
 * issued by the configured Supabase project.
 */
export function verifySupabaseToken(token: string): SupabaseClaims | null {
  if (!config.auth.supabaseJwtSecret || !config.auth.supabaseUrl) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string; typ?: string };
  let claims: SupabaseClaims;
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
    claims = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  // Refuse `none` and any asymmetric alg we have no key for.
  if (header.alg !== 'HS256') return null;
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  if (config.auth.supabaseUrl && claims.iss && !claims.iss.startsWith(config.auth.supabaseUrl)) return null;

  const expected = createHmac('sha256', config.auth.supabaseJwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlToBuf(sigB64);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return claims;
}

/** Provision the local mirror row for a Supabase-authenticated user. */
export function upsertSupabaseUser(sub: string, email: string | undefined): UserRecord {
  const byAuth = one<Record<string, any>>(`SELECT * FROM users WHERE id = ?`, [sub]);
  if (byAuth) return mapUser(byAuth);
  if (email) {
    const byEmail = findUserByEmail(email);
    if (byEmail) {
      // Link the Supabase identity to the account they already made locally,
      // rather than creating a second, empty account for the same person.
      return byEmail;
    }
  }
  const hash = `external:${sub}`;
  const at = nowIso();
  run(`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [
    sub, (email ?? `${sub}@supabase.local`).toLowerCase(), hash, at, at,
  ]);
  ensureProfileRow(sub);
  return { id: sub, email: (email ?? `${sub}@supabase.local`).toLowerCase(), passwordHash: hash, createdAt: at };
}

export function listUserIds(): string[] {
  return all<{ id: string }>(`SELECT id FROM users`).map((r) => r.id);
}
