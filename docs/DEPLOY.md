# Deploying

Two hosts, on purpose. The web app and the API have genuinely different runtime
requirements, and putting both on one of them breaks something.

| Piece | Host | Why there |
|---|---|---|
| `packages/web` (Vite SPA) | Vercel | Static assets. Free, global CDN, instant preview deploys per commit. |
| `packages/server` (Fastify) | Render (or Railway/Fly) | Needs a **writable persistent disk** for SQLite and a **long-lived process** for the 300 s scheduler. |

## Why the API is not on Vercel

Not a preference — two concrete blockers:

1. **SQLite needs a real filesystem.** `packages/server/src/db/index.ts` opens
   the database with `node:sqlite` and `mkdirSync`s its parent. Vercel functions
   have a read-only filesystem apart from an ephemeral `/tmp`, so every
   invocation would start from an empty database.
2. **The scheduler is a `setInterval`.** `packages/server/src/scheduler.ts:68`
   ticks every `SCHEDULER_TICK_SECONDS`. Vercel functions exist only for the
   duration of a request, so it would never run. Research runs are also
   multi-second crawls (up to 12 pages at 1200 ms politeness delay), well past
   serverless execution limits.

## Order of operations

Deploy the **API first**. Its URL is the `VITE_API_BASE` the web build needs, and
the API's `APP_ORIGIN` needs the web URL. One of the two has to exist first;
this way the loop closes in one direction.

### 1. Push the repo

```bash
git remote add origin https://github.com/<you>/job-eligibility-tracker.git
git push -u origin main
```

### 2. API on Render

Render reads `render.yaml` as a Blueprint:

- Dashboard → **New** → **Blueprint** → select the repo. Render applies
  `render.yaml` and creates the `jet-api` service plus a 1 GB disk at
  `/var/data`.
- Set the two required values it marks `sync: false`:
  - `APP_ORIGIN` — temporarily `http://localhost:5173`; you will replace it in
    step 3 once Vercel gives you a URL.
  - `CRAWL_USER_AGENT` — put a real contact address in it.
- `JWT_SECRET` is auto-generated. **Do not rotate it casually**: changing it
  invalidates every issued JWT and signs out all users.
- `DATABASE_URL=file:/var/data/jet.db` points at the disk, so the database
  survives redeploys. Back it up by copying that file off the disk.
- Note the service URL, e.g. `https://jet-api.onrender.com`.

Verify it before going further:

```bash
curl https://jet-api.onrender.com/api/health
```

It should report `"scheduler": true` and the database as node:sqlite. If the
service will not start, the usual cause is `JWT_SECRET` missing — config.ts
throws on that in production rather than running with a guessable secret.

> Free Render instances sleep after inactivity and have **no persistent disk**,
> so a free plan will lose your database. The blueprint uses `plan: starter` for
> that reason.

### 3. Web on Vercel

```bash
npm i -g vercel
vercel login
vercel link          # from the repo root
vercel env add VITE_API_BASE production      # https://jet-api.onrender.com
vercel deploy --prod
```

`vercel.json` at the repo root tells Vercel to build `packages/web` and publish
`packages/web/dist`. The rewrite rule is the load-bearing part: without it,
opening a deep link such as `/jobs/abc123` directly would return Vercel's 404
instead of the app, because the router only runs in the browser.

Leave the API key vars unset on the web side. They are server-side secrets and
`VITE_`-prefixed vars are baked into the public bundle.

### 4. Close the CORS loop

Now that Vercel has given you a production URL, set it on the API:

```
APP_ORIGIN=https://<your-vercel-project>.vercel.app
```

Render restarts the service when an env var changes, so the allowlist takes
effect immediately. Confirm the browser stops logging CORS errors.

`APP_ORIGIN` accepts a comma-separated list, so you can keep localhost for
local work:

```
APP_ORIGIN=https://<your-vercel-project>.vercel.app,http://localhost:5173
```

### 5. Preview deployments (optional)

Every Vercel preview gets a unique subdomain, which cannot be enumerated. Rather
than accepting any `*.vercel.app` — that would let any Vercel deployment read a
signed-in user's API responses — opt in explicitly:

```
APP_ORIGIN_ALLOW_VERCEL_PREVIEWS=true
```

`packages/server/test/cors.test.ts` pins this behaviour, including that the
match stays on `https://*.vercel.app` and rejects lookalikes.

### 6. Smoke test

Sign up, add a company, run research, and open a job deep link directly in a
new tab. That last one is what catches a missing SPA rewrite, and nothing else
will.

## Rollback

- **Web**: every Vercel deploy is immutable and promotable. Redeploy a previous
  build from the dashboard; no rebuild needed.
- **API**: Rollback to the previous deploy in the Render dashboard. The SQLite
  file is *not* versioned, so roll back the code, not the data. Restore the
  database by copying a known-good `jet.db` back onto the disk.
- **Frontend/API contract**: they are deployed independently, so a newer web
  build can briefly run against an older API. Keep additive changes on the
  server until the web side is safely rolled forward.

## Local development

Unchanged — Vite proxies `/api` to `localhost:4000`, so no CORS is involved:

```bash
npm run dev          # api on :4000, web on :5173
```

## Supabase

Deferred on purpose. `supabase/schema.sql` is a correct PostgreSQL target with
the RLS policies fixed and covered by 10 static tests, but **no Postgres data
layer exists**: `db()` in `packages/server/src/db/index.ts` only understands
`file:` URLs and will treat a `postgresql://` string as a filesystem path,
silently creating a junk file instead of connecting.

So migrating to Supabase Postgres means writing a real repository layer against
the existing schema. That is a separate, testable piece of work — do it after
this deploy is stable, not during it.

Auth is independent of the database: `AUTH_MODE=local` has the backend issue
its own JWTs and the frontend contract does not change.
