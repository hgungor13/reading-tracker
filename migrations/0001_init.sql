-- Reading Tracker — initial schema
-- Applied with: npm run db:migrate:local  (or :remote)

-- A person in a reading group.
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A book title.
CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  author     TEXT,
  total_pages INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A group reading one book, with a shared join code and a daily target.
CREATE TABLE IF NOT EXISTS reading_plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id        INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  group_code     TEXT NOT NULL UNIQUE,          -- name + code auth
  pages_per_day  INTEGER NOT NULL DEFAULT 10,
  start_date     TEXT NOT NULL,                 -- ISO yyyy-mm-dd
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A user's participation in a plan; each holds their own current page.
CREATE TABLE IF NOT EXISTS memberships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL REFERENCES reading_plans(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (plan_id, user_id)
);

-- One row per user per plan per day = "read today". Answers who read / who didn't.
CREATE TABLE IF NOT EXISTS reading_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id INTEGER NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  log_date    TEXT NOT NULL,                    -- ISO yyyy-mm-dd
  from_page   INTEGER,
  to_page     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (membership_id, log_date)              -- idempotent: one mark per day
);

-- Web Push subscriptions. A user can have several devices.
-- (user_id is nullable for now — the spike stores device-only subscriptions.)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_logs_date ON reading_logs (log_date);
CREATE INDEX IF NOT EXISTS idx_memberships_plan ON memberships (plan_id);
CREATE INDEX IF NOT EXISTS idx_subs_user ON push_subscriptions (user_id);
