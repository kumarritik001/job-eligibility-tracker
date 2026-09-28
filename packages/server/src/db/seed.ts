/**
 * Seed script.
 *
 * Creates the local account and a starting profile so the app is usable
 * immediately.
 *
 *   npm run seed
 *   SEED_EMAIL=me@example.com SEED_PASSWORD=... npm run seed
 *
 * This does NOT create any fake jobs. Job rows only ever come from a real,
 * fetched, source-verified posting.
 */

import { randomBytes, scrypt } from 'node:crypto';
import { createUser, ensureProfileRow, findUserByEmail } from '../services/auth.js';
import { loadProfile, saveProfile } from '../services/store.js';
import { closeDb, db } from './index.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

async function main(): Promise<void> {
  db();

  const email = process.env.SEED_EMAIL ?? 'you@example.com';
  const password = process.env.SEED_PASSWORD ?? 'change-me-please-123';

  let user = findUserByEmail(email);
  if (user) {
    console.log(`Account already exists for ${email}. Updating the profile instead.`);
  } else {
    user = createUser(email, await hashPasswordAsync(password));
    console.log(`Created account ${email}`);
  }
  ensureProfileRow(user.id);

  const existing = loadProfile(user.id);
  const save = saveProfile(user.id, {
    // Sensible starting points; the UI lets you change any of it.
    name: existing?.name || 'Your Name',
    degree: existing?.degree || 'B.Tech',
    branch: existing?.branch || 'Chemical Engineering',
    graduationYear: existing?.graduationYear || new Date().getFullYear(),
    skills: existing?.skills.length ? existing.skills : ['Python', 'SQL', 'Excel'],
    preferredLocations: existing?.preferredLocations.length ? existing.preferredLocations : ['India'],
    yearsOfExperience: existing?.yearsOfExperience ?? 0,
    minDesiredExperience: existing?.minDesiredExperience ?? 0,
    maxDesiredExperience: existing?.maxDesiredExperience ?? 2,
  });

  console.log('Profile ready. Start everything with: npm run dev');
  console.log(`Signed in as ${user.email} with graduation year ${save.graduationYear}.`);

  const notes: string[] = [];
  if (!process.env.SERPER_API_KEY && !process.env.BRAVE_API_KEY && !process.env.TAVILY_API_KEY) {
    notes.push(
      'No search API key set. Careers pages are still found by probing the company domain, but discovery is narrower. Add SERPER_API_KEY, BRAVE_API_KEY, or TAVILY_API_KEY for broader coverage.',
    );
  }
  if (!process.env.JWT_SECRET) {
    notes.push('JWT_SECRET is unset, so one is generated at each boot and sessions end on restart. Set it in .env.');
  }
  if (notes.length > 0) {
    console.log('\nNotes:');
    for (const n of notes) console.log(`  - ${n}`);
  }
}

function hashPasswordAsync(password: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const salt = randomBytes(16);
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
      (err, key) => {
        if (err) return reject(err);
        const k = key as Buffer;
        if (k.length !== SCRYPT.keylen) return reject(new Error('scrypt returned a key of the wrong length'));
        resolvePromise(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${k.toString('base64')}`);
      },
    );
  });
}

main()
  .then(() => {
    closeDb();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
