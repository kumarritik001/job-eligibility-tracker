/**
 * CORS allowlist tests.
 *
 * The web app and the API are deployed to different hosts, so the origin check
 * is a security boundary rather than a convenience: get it wrong and any site
 * a user visits can call the API with their Bearer token and read their job
 * data, because the token rides in an Authorization header that CORS is the
 * only thing gating.
 *
 * The predicate is a pure factory specifically so these cases can be pinned
 * down without reloading the config module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createOriginChecker } from '../src/config.js';

const PROD = ['https://jet-tracker.vercel.app'];
const LOCAL = 'http://localhost:5173';

test('allows an explicitly listed origin', () => {
  const check = createOriginChecker(PROD, false);
  assert.equal(check(PROD[0]), true);
  assert.equal(check(LOCAL), false);
});

test('allows a same-origin or server-side call with no Origin header', () => {
  const check = createOriginChecker(PROD, false);
  assert.equal(check(undefined), true);
  assert.equal(check(''), true);
});

test('refuses an unlisted origin, including a lookalike of a listed one', () => {
  const check = createOriginChecker(PROD, false);
  assert.equal(check('https://evil.example.com'), false);
  // Prefix/suffix tricks must not pass: an exact match is the only rule.
  assert.equal(check('https://jet-tracker.vercel.app.evil.com'), false);
  assert.equal(check('https://notjet-tracker.vercel.app'), false);
  assert.equal(check('http://jet-tracker.vercel.app'), false); // scheme must match
});

test('refuses plain http for a vercel preview even when previews are on', () => {
  const check = createOriginChecker(PROD, true);
  assert.equal(check('https://jet-tracker-abc123.vercel.app'), true);
  assert.equal(check('http://jet-tracker-abc123.vercel.app'), false);
});

test('vercel previews stay off unless explicitly enabled', () => {
  const off = createOriginChecker(PROD, false);
  const on = createOriginChecker(PROD, true);
  const preview = 'https://jet-tracker-abc123.vercel.app';
  assert.equal(off(preview), false);
  assert.equal(on(preview), true);
});

test('previews never widen the match beyond vercel.app', () => {
  const check = createOriginChecker(PROD, true);
  assert.equal(check('https://abc.vercel.app.evil.com'), false);
  assert.equal(check('https://abc.vercel.app.attacker.co'), false);
  assert.equal(check('https://evil.com/jet-tracker.vercel.app'), false);
});

test('an empty allowlist refuses every real origin', () => {
  const check = createOriginChecker([], false);
  assert.equal(check('https://anything.example.com'), false);
  assert.equal(check(undefined), true);
});

test('the server registers cors with the function, not a bare string', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8');
  // A bare string origin allows exactly one host and silently breaks every
  // preview deployment, so assert the shape rather than trusting a comment.
  assert.match(source, /origin:\s*\(origin,\s*callback\)\s*=>/);
  assert.doesNotMatch(source, /origin:\s*config\.appOrigin\s*,/);
});
