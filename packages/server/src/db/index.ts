/**
 * Database access layer.
 *
 * Development uses the built-in `node:sqlite` driver so the app runs with zero
 * external services. The SQL is written to be portable; supabase/schema.sql is
 * the PostgreSQL target and the repository functions below are the only place
 * that would need to change to switch drivers.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, any>;

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  const url = process.env.DATABASE_URL ?? 'file:./data/jet.db';
  const path = url.startsWith('file:') ? url.slice(5) : url;
  const abs = resolve(process.cwd(), path);
  mkdirSync(dirname(abs), { recursive: true });
  const conn = new DatabaseSync(abs);
  // SQLite ignores ON DELETE CASCADE unless foreign keys are enabled, and the
  // setting is per connection. Without this, deleting a company would silently
  // orphan its jobs and leave them in the dashboard counts.
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  _db = conn;
  return conn;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

export function uid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

// --- Query helpers ---------------------------------------------------------

export function all<T = Row>(sql: string, params: unknown[] = []): T[] {
  return db().prepare(sql).all(...(params as any[])) as T[];
}

export function one<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  return db().prepare(sql).get(...(params as any[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  // Deliberately no SQL/params logging on failure: params carry password
  // hashes and emails. If that is ever needed, log statement text only.
  const r = db().prepare(sql).run(...(params as any[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export function exec(sql: string): void {
  db().exec(sql);
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec('BEGIN');
  try {
    const out = fn();
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

// --- JSON column helpers ---------------------------------------------------

export function j(value: unknown): string {
  return JSON.stringify(value ?? []);
}

export function toArray<T = string>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? (p as T[]) : [];
  } catch {
    return [];
  }
}

export function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return {};
  try {
    const p = JSON.parse(value);
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';
export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
