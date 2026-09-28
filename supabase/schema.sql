-- ===========================================================================
--  Job Eligibility Tracker - PostgreSQL / Supabase schema
--  Apply with:  psql "$DATABASE_URL" -f supabase/schema.sql
--  or paste into the Supabase SQL editor.
--
--  The development database (node:sqlite, packages/server/src/db/schema.sql)
--  mirrors this structure. Keep the two in sync.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- users  (mirrors auth.users; the profile row is created by a trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique not null references auth.users (id) on delete cascade,
  email       citext unique not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id                uuid primary key references public.users (id) on delete cascade,
  name                   text not null default '',
  degree                 text not null default '',
  branch                 text not null default '',
  college                text,
  graduation_year        int,
  cgpa                   numeric(4,2),
  cgpa_scale             numeric(4,2) not null default 10,

  gate_score             int,
  gate_rank              int,
  gate_year              int,
  gate_branch            text,

  years_of_experience    numeric(4,2) not null default 0,
  min_desired_experience numeric(4,2) not null default 0,
  max_desired_experience numeric(4,2) not null default 5,

  internships            text not null default '',
  certifications         text[] not null default '{}',
  skills                 text[] not null default '{}',

  work_authorization     text[] not null default '{}',
  preferred_locations    text[] not null default '{}',
  preferred_job_types    text[] not null default '{}',
  willing_to_relocate    boolean not null default false,

  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.users (id) on delete cascade,
  name                    text not null,
  normalized_name         text not null,
  official_website        text,
  careers_url             text,
  logo_url                text,
  ats_provider            text,
  careers_url_confidence  numeric(4,3),
  careers_url_source      text,
  refresh_mode            text not null default 'MANUAL'
                            check (refresh_mode in ('MANUAL','EVERY_6H','EVERY_12H','DAILY')),
  added_at                timestamptz not null default now(),
  last_researched_at      timestamptz,
  next_research_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id, normalized_name)
);
create index if not exists companies_user_idx on public.companies (user_id);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  external_job_id         text,
  title                   text not null,
  department              text,
  category                text,
  location                text,
  city                    text,
  country                 text,
  employment_type         text,
  work_arrangement        text,

  posted_at               date,
  closing_at              date,

  experience_min          numeric(4,2),
  experience_max          numeric(4,2),
  education_requirement   text,
  required_field          text,
  required_skills         text[] not null default '{}',
  preferred_skills        text[] not null default '{}',
  certifications          text[] not null default '{}',
  salary                  text,

  description             text,
  responsibilities        text[] not null default '{}',
  eligibility_requirements text[] not null default '{}',

  -- Structured, normalized requirements produced by the extractor.
  requirements            jsonb not null default '{}'::jsonb,

  source_url              text not null,
  source_name             text not null,
  is_official_source      boolean not null default false,
  also_seen_at            text[] not null default '{}',

  status                  text not null default 'ACTIVE'
                            check (status in ('ACTIVE','EXPIRED','REMOVED','UNKNOWN')),
  verification            text not null default 'UNVERIFIED'
                            check (verification in ('VERIFIED_ACTIVE','LAST_VERIFIED_UNAVAILABLE','UNVERIFIED')),
  dedupe_fingerprint      text not null,

  first_seen_at           timestamptz not null default now(),
  last_verified_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (company_id, dedupe_fingerprint)
);
create index if not exists jobs_company_idx      on public.jobs (company_id);
create index if not exists jobs_company_status_idx on public.jobs (company_id, status);
create index if not exists jobs_posted_idx       on public.jobs (posted_at desc);
create index if not exists jobs_closing_idx       on public.jobs (closing_at);
create index if not exists jobs_fingerprint_idx   on public.jobs (dedupe_fingerprint);

-- ---------------------------------------------------------------------------
-- job_requirements  (denormalised per-job requirement rows for auditing/UI)
-- ---------------------------------------------------------------------------
create table if not exists public.job_requirements (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  requirement_type  text not null,
  requirement_value text,
  normalized_value  text,
  is_mandatory      boolean not null default false,
  origin            text not null default 'EXPLICIT'
                      check (origin in ('EXPLICIT','INFERRED','LLM','MISSING')),
  evidence          text,
  created_at        timestamptz not null default now(),
  unique (job_id, requirement_type, normalized_value)
);
create index if not exists job_requirements_job_idx on public.job_requirements (job_id);

-- ---------------------------------------------------------------------------
-- job_sources  (every sighting of a job, including duplicates we merged away)
-- ---------------------------------------------------------------------------
create table if not exists public.job_sources (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  source_url    text not null,
  source_name   text not null,
  is_official   boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (job_id, source_url)
);

-- ---------------------------------------------------------------------------
-- eligibility_results
-- ---------------------------------------------------------------------------
create table if not exists public.eligibility_results (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.jobs (id) on delete cascade,
  user_id               uuid not null references public.users (id) on delete cascade,
  status                text not null check (status in ('ELIGIBLE','INELIGIBLE','UNCERTAIN')),
  match_score           int check (match_score between 0 and 100),
  education_match       int,
  experience_match      int,
  skills_match          int,
  location_match        int,
  matched_requirements  text[] not null default '{}',
  missing_requirements  text[] not null default '{}',
  concerns              text[] not null default '{}',
  missing_information   text[] not null default '{}',
  checks                jsonb not null default '[]'::jsonb,
  explanation           text,
  engine                text,
  analyzed_at           timestamptz not null default now(),
  unique (job_id, user_id)
);
create index if not exists eligibility_user_status_idx
  on public.eligibility_results (user_id, status);

-- ---------------------------------------------------------------------------
-- research_runs
-- ---------------------------------------------------------------------------
create table if not exists public.research_runs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  status          text not null default 'PENDING'
                    check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  jobs_found      int not null default 0,
  jobs_new        int not null default 0,
  jobs_updated    int not null default 0,
  jobs_removed    int not null default 0,
  eligible_jobs   int not null default 0,
  sources_tried   text[] not null default '{}',
  sources_ok      text[] not null default '{}',
  steps           jsonb not null default '[]'::jsonb,
  error_message   text
);
create index if not exists research_runs_company_idx
  on public.research_runs (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        text not null,
  company_id  uuid references public.companies (id) on delete cascade,
  job_id      uuid references public.jobs (id) on delete cascade,
  title       text not null,
  body        text,
  read_at     timestamptz,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- user_company_watchlist
-- ---------------------------------------------------------------------------
create table if not exists public.user_company_watchlist (
  user_id           uuid not null references public.users (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  added_at          timestamptz not null default now(),
  refresh_mode      text not null default 'MANUAL'
                      check (refresh_mode in ('MANUAL','EVERY_6H','EVERY_12H','DAILY')),
  pinned            boolean not null default false,
  primary key (user_id, company_id)
);

-- ---------------------------------------------------------------------------
-- email_preferences (strictly opt-in; nothing is sent unless enabled = true)
-- ---------------------------------------------------------------------------
create table if not exists public.email_preferences (
  user_id    uuid primary key references public.users (id) on delete cascade,
  enabled    boolean not null default false,
  frequency  text not null default 'DAILY'
               check (frequency in ('IMMEDIATELY','DAILY','WEEKLY')),
  email      citext,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
--  Row Level Security
--  Every table is user-scoped. The service role bypasses RLS; the anon/auth
--  role does not, so a client can only ever see its own rows.
--
--  Identity model (this is the part that is easy to get wrong):
--
--    auth.users.id  ==  public.users.auth_id      (1:1, unique, not null)
--    public.users.id                              (internal surrogate PK)
--
--  Every application table stores `user_id` referencing public.users(id) --
--  the *surrogate*, not auth.users.id. So a bare `user_id = auth.uid()` is
--  only correct for those child tables, and would silently match nothing.
--  public.users itself has no `user_id` column at all; it is scoped by
--  `auth_id = auth.uid()`.
-- ===========================================================================
alter table public.users              enable row level security;
alter table public.user_profiles      enable row level security;
alter table public.companies          enable row level security;
alter table public.jobs               enable row level security;
alter table public.job_requirements   enable row level security;
alter table public.job_sources        enable row level security;
alter table public.eligibility_results enable row level security;
alter table public.research_runs      enable row level security;
alter table public.notifications      enable row level security;
alter table public.user_company_watchlist enable row level security;
alter table public.email_preferences  enable row level security;

-- public.users is the one table scoped by auth_id rather than user_id.
-- Reading: a user sees only their own row. Writing: `with check` prevents a
-- user from inserting or re-pointing a row to someone else's auth identity.
drop policy if exists users_own on public.users;
create policy users_own on public.users for all
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- Child tables: user_id is public.users.id, so it is compared against the
-- caller's own public.users row rather than directly against auth.uid().
-- Doing the lookup in one place keeps the predicate honest and cheap.
create or replace function public.current_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.id from public.users u where u.auth_id = auth.uid();
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles','companies','research_runs','notifications',
    'email_preferences','user_company_watchlist','eligibility_results'
  ] loop
    -- Dropped first so this file can be re-applied to an existing database.
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all using (user_id = public.current_user_id()) with check (user_id = public.current_user_id())',
      t || '_own', t);
  end loop;
end $$;

-- Child tables reach the user through their parent company/job.
drop policy if exists jobs_own on public.jobs;
create policy jobs_own on public.jobs for all
  using (exists (select 1 from public.companies c where c.id = jobs.company_id and c.user_id = public.current_user_id()))
  with check (exists (select 1 from public.companies c where c.id = jobs.company_id and c.user_id = public.current_user_id()));

drop policy if exists job_requirements_own on public.job_requirements;
create policy job_requirements_own on public.job_requirements for all
  using (exists (select 1 from public.jobs j join public.companies c on c.id = j.company_id
                 where j.id = job_requirements.job_id and c.user_id = public.current_user_id()))
  with check (exists (select 1 from public.jobs j join public.companies c on c.id = j.company_id
                 where j.id = job_requirements.job_id and c.user_id = public.current_user_id()));

drop policy if exists job_sources_own on public.job_sources;
create policy job_sources_own on public.job_sources for all
  using (exists (select 1 from public.jobs j join public.companies c on c.id = j.company_id
                 where j.id = job_sources.job_id and c.user_id = public.current_user_id()))
  with check (exists (select 1 from public.jobs j join public.companies c on c.id = j.company_id
                 where j.id = job_sources.job_id and c.user_id = public.current_user_id()));

-- ===========================================================================
--  Triggers
-- ===========================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'users','user_profiles','companies','jobs','email_preferences'
  ] loop
    -- Dropped first so this file can be re-applied to an existing database.
    execute format('drop trigger if exists %I before update on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Auto-provision a profile row when a Supabase auth user signs up.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (auth_id, email) values (new.id, new.email)
    on conflict (auth_id) do nothing;
  insert into public.user_profiles (user_id, name)
    select u.id, coalesce(new.raw_user_meta_data->>'full_name', '')
    from public.users u where u.auth_id = new.id
    on conflict (user_id) do nothing;
  insert into public.email_preferences (user_id, email) values ((select id from public.users where auth_id = new.id), new.email)
    on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
