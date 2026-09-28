-- ===========================================================================
--  Job Eligibility Tracker - development schema (node:sqlite)
--  Mirrors supabase/schema.sql. SQLite has no arrays or JSONB, so list
--  columns are JSON text and structured payloads are TEXT holding JSON.
-- ===========================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL DEFAULT '',
  degree                 TEXT NOT NULL DEFAULT '',
  branch                 TEXT NOT NULL DEFAULT '',
  college                TEXT,
  graduation_year        INTEGER,
  cgpa                   REAL,
  cgpa_scale             REAL NOT NULL DEFAULT 10,

  gate_score             INTEGER,
  gate_rank              INTEGER,
  gate_year              INTEGER,
  gate_branch            TEXT,

  years_of_experience    REAL NOT NULL DEFAULT 0,
  min_desired_experience REAL NOT NULL DEFAULT 0,
  max_desired_experience REAL NOT NULL DEFAULT 5,

  internships            TEXT NOT NULL DEFAULT '',
  certifications         TEXT NOT NULL DEFAULT '[]',
  skills                 TEXT NOT NULL DEFAULT '[]',

  work_authorization     TEXT NOT NULL DEFAULT '[]',
  preferred_locations    TEXT NOT NULL DEFAULT '[]',
  preferred_job_types    TEXT NOT NULL DEFAULT '[]',
  willing_to_relocate    INTEGER NOT NULL DEFAULT 0,

  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  normalized_name        TEXT NOT NULL,
  official_website       TEXT,
  careers_url            TEXT,
  logo_url               TEXT,
  ats_provider           TEXT,
  careers_url_confidence REAL,
  careers_url_source     TEXT,
  refresh_mode           TEXT NOT NULL DEFAULT 'MANUAL',
  added_at               TEXT NOT NULL,
  last_researched_at     TEXT,
  next_research_at       TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (user_id, normalized_name)
);
CREATE INDEX IF NOT EXISTS companies_user_idx ON companies(user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_job_id         TEXT,
  title                   TEXT NOT NULL,
  department              TEXT,
  category                TEXT,
  location                TEXT,
  city                    TEXT,
  country                 TEXT,
  employment_type         TEXT,
  work_arrangement        TEXT,

  posted_at               TEXT,
  closing_at              TEXT,

  experience_min          REAL,
  experience_max          REAL,
  education_requirement   TEXT,
  required_field          TEXT,
  required_skills         TEXT NOT NULL DEFAULT '[]',
  preferred_skills        TEXT NOT NULL DEFAULT '[]',
  certifications          TEXT NOT NULL DEFAULT '[]',
  salary                  TEXT,

  description             TEXT,
  responsibilities        TEXT NOT NULL DEFAULT '[]',
  eligibility_requirements TEXT NOT NULL DEFAULT '[]',
  requirements            TEXT NOT NULL DEFAULT '{}',

  source_url              TEXT NOT NULL,
  source_name             TEXT NOT NULL,
  is_official_source      INTEGER NOT NULL DEFAULT 0,
  also_seen_at            TEXT NOT NULL DEFAULT '[]',

  status                  TEXT NOT NULL DEFAULT 'ACTIVE',
  verification            TEXT NOT NULL DEFAULT 'UNVERIFIED',
  dedupe_fingerprint      TEXT NOT NULL,

  first_seen_at           TEXT NOT NULL,
  last_verified_at        TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (company_id, dedupe_fingerprint)
);
CREATE INDEX IF NOT EXISTS jobs_company_status_idx ON jobs(company_id, status);
CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS jobs_closing_idx ON jobs(closing_at);

CREATE TABLE IF NOT EXISTS job_requirements (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  requirement_type  TEXT NOT NULL,
  requirement_value TEXT,
  normalized_value  TEXT,
  is_mandatory      INTEGER NOT NULL DEFAULT 0,
  origin            TEXT NOT NULL DEFAULT 'EXPLICIT',
  evidence          TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (job_id, requirement_type, normalized_value)
);
CREATE INDEX IF NOT EXISTS job_requirements_job_idx ON job_requirements(job_id);

CREATE TABLE IF NOT EXISTS job_sources (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_url    TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  is_official   INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (job_id, source_url)
);

CREATE TABLE IF NOT EXISTS eligibility_results (
  id                   TEXT PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               TEXT NOT NULL,
  match_score          INTEGER,
  education_match      INTEGER,
  experience_match     INTEGER,
  skills_match         INTEGER,
  location_match       INTEGER,
  matched_requirements TEXT NOT NULL DEFAULT '[]',
  missing_requirements TEXT NOT NULL DEFAULT '[]',
  concerns             TEXT NOT NULL DEFAULT '[]',
  missing_information  TEXT NOT NULL DEFAULT '[]',
  checks               TEXT NOT NULL DEFAULT '[]',
  explanation          TEXT,
  engine               TEXT,
  analyzed_at          TEXT NOT NULL,
  UNIQUE (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS eligibility_user_status_idx ON eligibility_results(user_id, status);

CREATE TABLE IF NOT EXISTS research_runs (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  jobs_found     INTEGER NOT NULL DEFAULT 0,
  jobs_new       INTEGER NOT NULL DEFAULT 0,
  jobs_updated   INTEGER NOT NULL DEFAULT 0,
  jobs_removed   INTEGER NOT NULL DEFAULT 0,
  eligible_jobs  INTEGER NOT NULL DEFAULT 0,
  sources_tried  TEXT NOT NULL DEFAULT '[]',
  sources_ok     TEXT NOT NULL DEFAULT '[]',
  steps          TEXT NOT NULL DEFAULT '[]',
  error_message  TEXT
);
CREATE INDEX IF NOT EXISTS research_runs_company_idx ON research_runs(company_id, started_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  job_id      TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  read_at     TEXT,
  emailed_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_company_watchlist (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  added_at     TEXT NOT NULL,
  refresh_mode TEXT NOT NULL DEFAULT 'MANUAL',
  pinned       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS email_preferences (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL DEFAULT 0,
  frequency  TEXT NOT NULL DEFAULT 'DAILY',
  email      TEXT,
  updated_at TEXT NOT NULL
);
