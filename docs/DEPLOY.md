# Deploying

Two hosts, on purpose. The web app and the API have genuinely different runtime
requirements, and putting both on one of them breaks something.

| Piece | Host | Why there |
|---|---|---|
| `packages/web` (Vite SPA) | Vercel | Static assets. Free, global CDN, instant preview deploys per commit. |
| `packages/server` (Fastify) | Render (or Railway/Fly) | Needs a **writable persistent disk** for SQLite and a **long-lived process** for the 300 s scheduler. |

## Current state

| | |
|---|---|
| Web | **Deployed.** https://job-eligibility-tracker.vercel.app — Vercel project `ritspective/job-eligibility-tracker`. Builds and serves; deep links and asset caching verified. |
| API | **Not deployed.** The app is a shell until the Render service exists: every request goes to the Vercel origin and 404s, and the console says so. |
| GitHub | https://github.com/kumarritik001/job-eligibility-tracker, 5 commits on `main`. |

To finish: create the Render API, then set `VITE_API_BASE` on Vercel and
`APP_ORIGIN` on Render. Steps 3–4 below, with the real values.

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

## Node version drift

Three hosts, three runtimes: `.node-version` pins Render to 22.19.0, your local
is 22, and Vercel builds on 24.x because the root `engines.node` is `>=22.5.0`.
The web build only emits static assets, so this is currently harmless — the
production build has been verified on 24. If a future Vercel default changes,
suspect this first.

## Order of operations

Deploy the **API first**. Its URL is the `VITE_API_BASE` the web build needs, and
the API's `APP_ORIGIN` needs the web URL. One of the two has to exist first;
this way the loop closes in one direction.

The web app is already up, which is fine: it is static and does not care that the
API does not exist yet. It just cannot talk to anything until `VITE_API_BASE` is
set and the project is rebuilt.

### 1. Push the repo

Done — `main` is on https://github.com/kumarritik001/job-eligibility-tracker.
For a fresh clone:

```bash
git remote add origin https://github.com/kumarritik001/job-eligibility-tracker.git
git push -u origin main
```

Render needs the repo on GitHub to build the Blueprint, so do not skip this.

### 2. API on Render

Render reads `render.yaml` as a Blueprint:

- Dashboard → **New** → **Blueprint** → select the repo. Render applies
  `render.yaml` and creates the `jet-api` service plus a 1 GB disk at
  `/var/data`.
- Set the two required values it marks `sync: false`:
  - `APP_ORIGIN` — `https://job-eligibility-tracker.vercel.app`. This is final:
    the web origin already exists, so there is no need for a localhost
    placeholder and a later correction. Add a second comma-separated entry only
    if you also serve the web app from another origin.
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

Already deployed. Only the API base is missing, and it has to be baked in at
build time — Vite inlines `VITE_API_BASE` into the bundle, so setting it in the
dashboard alone does nothing until a rebuild happens.

```bash
vercel link                        # already done: ritspective/job-eligibility-tracker
vercel env add VITE_API_BASE production      # https://jet-api.onrender.com
vercel deploy --prod
```

`vercel.json` at the repo root tells Vercel to build `packages/web` and publish
`packages/web/dist`. The rewrite rule is the load-bearing part: without it,
opening a deep link such as `/jobs/abc123` directly would return Vercel's 404
instead of the app, because the router only runs in the browser. Verified
working in production for `/login`, `/jobs/:id`, `/companies/:id` and `/settings`.

> The GitHub repo is **not** connected to the Vercel project, so pushes do not
> redeploy on their own — every change needs an explicit `vercel deploy --prod`.
> Fix with **Vercel → Settings → Git → Connect Git Repository**, or install the
> Vercel app on the repository.

Leave the API key vars unset on the web side. They are server-side secrets and
`VITE_`-prefixed vars are baked into the public bundle.

> `vercel.json` sets `installCommand: npm ci --include=dev` on purpose. Vercel
> sets `NODE_ENV=production` for the build phase, which makes a bare `npm ci`
> skip devDependencies — and `vite`, `tailwindcss` and `@vitejs/plugin-react`
> all live there, so the build would fail with "vite: not found". The same trap
> applies to the Render blueprint, which is why it uses `npm ci --include=dev`
> too.

### 4. Close the CORS loop

`APP_ORIGIN` was set to the production web origin when the Render service was
created, so this is already closed — the loop is only open in one direction
(`VITE_API_BASE`) at that point. Confirm the browser console is free of CORS
errors and the dashboard loads data.

If you need to change it:

```
APP_ORIGIN=https://job-eligibility-tracker.vercel.app
```

Render restarts the service when an env var changes, so the allowlist takes
effect immediately. Confirm the browser stops logging CORS errors.

`APP_ORIGIN` accepts a comma-separated list, so you can keep localhost for
local work against the deployed API:

```
APP_ORIGIN=https://job-eligibility-tracker.vercel.app,http://localhost:5173
```

Keep the production origin first: `config.ts` uses the first entry as the
default `appOrigin`.

Verified behaviour: an allowed origin receives `Access-Control-Allow-Origin`;
`https://evil.example.com`, `http://localhost:5173.evil.com` and a
`*.vercel.app` preview subdomain all receive nothing.

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
