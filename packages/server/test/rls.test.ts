/**
 * Supabase/PostgreSQL schema regression tests.
 *
 * These tests parse supabase/schema.sql and verify the security-critical
 * invariants that a live database would otherwise be needed to check. The
 * first version of this file exists because the RLS policies were generated
 * in a loop that assumed every table has a `user_id` column -- but
 * `public.users` does not, and it is scoped by `auth_id` instead. That
 * produced a policy that could not compile.
 *
 * Why static analysis: no Postgres instance is available in this environment,
 * and RLS bugs are exactly the kind that must not be discovered in
 * production. The checks below are deliberately structural -- they assert the
 * identity model the rest of the schema depends on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', '..', '..', 'supabase', 'schema.sql');
const sql = readFileSync(schemaPath, 'utf8');

/** Strip `--` line comments so they cannot be mistaken for SQL. */
const code = sql
  .split('\n')
  .map((l) => {
    const i = l.indexOf('--');
    return i === -1 ? l : l.slice(0, i);
  })
  .join('\n');

/** Extract a CREATE TABLE block and return its column names. */
function tableColumns(table: string): Set<string> {
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`, 'i');
  const m = code.match(re);
  if (!m) throw new Error(`could not find the definition of public.${table}`);
  const body = m[1];
  const cols = new Set<string>();
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      const first = current.trim().split(/\s+/)[0];
      if (first && !/^(constraint|primary|foreign|unique|check)$/i.test(first)) cols.add(first.replace(/"/g, '').toLowerCase());
      current = '';
    } else current += ch;
  }
  const first = current.trim().split(/\s+/)[0];
  if (first && !/^(constraint|primary|foreign|unique|check)$/i.test(first)) cols.add(first.replace(/"/g, '').toLowerCase());
  return cols;
}

/** All tables that have RLS enabled. */
function rlsTables(): string[] {
  return [...code.matchAll(/alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1].toLowerCase());
}

/** Tables covered by the `foreach ... in array [...]` policy loop. */
function loopTables(): string[] {
  const m = code.match(/foreach\s+t\s+in\s+array\s+array\[([\s\S]*?)\]\s+loop/i);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase());
}

/** The predicate the loop applies to each of its tables. */
function loopPredicate(): { using: string; withCheck: string } {
  const m = code.match(
    /'create policy %I on public\.%I for all using \(([\s\S]*?)\) with check \(([\s\S]*?)\)'/i,
  );
  return { using: m?.[1]?.trim() ?? '', withCheck: m?.[2]?.trim() ?? '' };
}

/** All policies, as { name, table, using, withCheck }, including loop-generated ones. */
function policies(): Array<{ name: string; table: string; using: string; withCheck: string }> {
  const out: Array<{ name: string; table: string; using: string; withCheck: string }> = [];
  const re = /create\s+policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+all\s+([\s\S]*?);/gi;
  for (const m of code.matchAll(re)) {
    const body = m[3];
    const using_ = body.match(/using\s*\(([\s\S]*)\)\s*with\s+check\s*\(([\s\S]*)\)/i)
      ?? body.match(/using\s*\(([\s\S]*)\)/i);
    out.push({
      name: m[1].toLowerCase(),
      table: m[2].toLowerCase(),
      using: (using_?.[1] ?? '').trim(),
      withCheck: (using_?.[2] ?? '').trim(),
    });
  }
  // The loop generates one `<table>_own` policy per listed table, so expand
  // it here; otherwise loop-covered tables look unprotected.
  const { using, withCheck } = loopPredicate();
  for (const t of loopTables()) {
    out.push({ name: `${t}_own`, table: t, using, withCheck });
  }
  return out;
}

// ---------------------------------------------------------------------------

test('public.users is scoped by auth_id, because it has no user_id column', () => {
  const cols = tableColumns('users');
  assert.ok(cols.has('auth_id'), 'public.users must keep its auth_id link to auth.users');
  assert.ok(cols.has('id'), 'public.users must keep its internal id');
  assert.ok(!cols.has('user_id'), 'public.users has no user_id column; policies must not reference one');

  const usersPolicies = policies().filter((p) => p.table === 'users');
  assert.equal(usersPolicies.length, 1, 'public.users needs exactly one policy');
  const p = usersPolicies[0];
  assert.match(p.using, /auth_id\s*=\s*auth\.uid\(\)/, 'the using clause must compare auth_id to auth.uid()');
  assert.match(p.withCheck, /auth_id\s*=\s*auth\.uid\(\)/, 'the with-check clause must also use auth_id');
});

test('public.users.auth_id is a unique, non-null reference to auth.users', () => {
  const cols = tableColumns('users');
  assert.ok(cols.has('auth_id'));
  const m = code.match(/auth_id\s+uuid\s+unique\s+not\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)/i);
  assert.ok(m, 'auth_id must be a unique non-null FK to auth.users(id); a nullable FK would leave rows unscopable');
});

test('every child table stores user_id referencing public.users(id)', () => {
  // These are the tables the loop-generated policy applies to. Each must
  // genuinely have a user_id column, otherwise the same bug recurs.
  for (const t of ['user_profiles', 'companies', 'research_runs', 'notifications', 'email_preferences', 'user_company_watchlist', 'eligibility_results']) {
    const cols = tableColumns(t);
    assert.ok(cols.has('user_id'), `public.${t} must have a user_id column`);
  }
});

test('no RLS policy references a column its table does not have', () => {
  // The regression test for the original bug, generalised: a policy that
  // mentions a missing column cannot compile against the real database.
  for (const p of policies()) {
    const cols = tableColumns(p.table);
    for (const clause of [p.using, p.withCheck]) {
      // Only bare column references matter; qualified ones (c.user_id) belong
      // to a joined alias and are checked separately.
      for (const m of clause.matchAll(/(^|[\s(])([a-z_][a-z0-9_]*)\s*(?:=|<>|!=|\bin\b)/gi)) {
        const col = m[2].toLowerCase();
        if (['auth', 'public', 'select', 'and', 'or', 'not', 'exists', 'where', 'from'].includes(col)) continue;
        assert.ok(cols.has(col), `policy ${p.name} on public.${p.table} references "${col}", which is not a column of that table`);
      }
    }
  }
});

test('child policies resolve the caller through current_user_id(), not auth.uid()', () => {
  // user_id holds public.users.id (a surrogate). Comparing it to auth.uid()
  // would match nothing and silently hide every row from the user.
  assert.match(code, /create or replace function public\.current_user_id\(\)/i, 'the resolver function must exist');

  for (const p of policies()) {
    if (p.table === 'users') continue;
    const clauses = `${p.using} ${p.withCheck}`;
    assert.ok(
      !/=\s*auth\.uid\(\)/.test(clauses),
      `policy ${p.name} compares a stored user_id to auth.uid() directly; it must use public.current_user_id()`,
    );
  }
});

test('every table with RLS enabled has at least one policy', () => {
  const withPolicies = new Set(policies().map((p) => p.table));
  for (const t of rlsTables()) {
    assert.ok(withPolicies.has(t), `public.${t} has RLS enabled but no policy; it would deny all access`);
  }
});

test('every policy guards writes with a with-check clause', () => {
  // `using` alone protects reads. Without `with check` a user could insert or
  // update a row pointing at someone else's account.
  for (const p of policies()) {
    assert.ok(p.withCheck.length > 0, `policy ${p.name} has no with-check clause, so writes are not scoped`);
  }
});

test('the resolver function is security definer to avoid RLS recursion', () => {
  // current_user_id() reads public.users, which itself has RLS. Without
  // SECURITY DEFINER the policy would recurse.
  const m = code.match(/create or replace function public\.current_user_id\(\)\s*\nreturns uuid language sql ([\s\S]*?)as \$\$/i);
  assert.ok(m, 'could not find the current_user_id() definition');
  assert.match(m[1], /security\s+definer/i, 'current_user_id() must be SECURITY DEFINER to bypass its own table RLS');
  assert.match(m[1], /set\s+search_path\s*=\s*public/i, 'current_user_id() must pin its search_path');
});

test('policies and triggers are re-appliable to an existing database', () => {
  // Loop-generated policies are dropped inside the same loop, so a single
  // generic drop is enough evidence for every table it covers.
  const loopDrops = new Set(loopTables());
  for (const p of policies()) {
    if (loopDrops.has(p.table) && /drop\s+policy\s+if\s+exists\s+%I/i.test(code)) continue;
    assert.match(code, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${p.name}\\b`, 'i'), `policy ${p.name} must be dropped before recreation`);
  }
  assert.match(code, /drop\s+trigger\s+if\s+exists/i, 'triggers must be dropped before recreation');
});

test('the signup trigger provisions rows keyed on auth_id', () => {
  const m = code.match(/insert into public\.users \(auth_id, email\)[^;]*;/i);
  assert.ok(m, 'the signup trigger must insert into public.users using auth_id');
  assert.match(code, /from public\.users u where u\.auth_id = new\.id/i, 'child rows must be resolved by auth_id, not by a guessed id');
});
