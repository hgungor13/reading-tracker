-- Milestone 4: generated per-reader schedules.
-- The plan holds the shared cadence; each member generates their own period
-- rows from their own start page (memberships.assigned_from, else plan.start_page).

ALTER TABLE reading_plans ADD COLUMN end_date TEXT;                             -- goal deadline (ISO yyyy-mm-dd)
ALTER TABLE reading_plans ADD COLUMN start_page INTEGER NOT NULL DEFAULT 1;     -- default first page
ALTER TABLE reading_plans ADD COLUMN pages_per_period INTEGER NOT NULL DEFAULT 10; -- pages to READ each period (constant)
ALTER TABLE reading_plans ADD COLUMN page_step INTEGER NOT NULL DEFAULT 0;          -- how far the start page advances each period; 0 => contiguous (= pages_per_period)
ALTER TABLE reading_plans ADD COLUMN period_unit TEXT NOT NULL DEFAULT 'day'
  CHECK (period_unit IN ('day', 'week', 'month'));                              -- frequency unit
ALTER TABLE reading_plans ADD COLUMN period_every INTEGER NOT NULL DEFAULT 1;   -- every N units
ALTER TABLE reading_plans ADD COLUMN reader_count INTEGER;                      -- planned headcount (optional)

-- One row per reader per period: their target range and when it's due.
CREATE TABLE IF NOT EXISTS reading_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id INTEGER NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,          -- 1-based order
  due_date      TEXT NOT NULL,             -- ISO yyyy-mm-dd
  from_page     INTEGER NOT NULL,
  to_page       INTEGER NOT NULL,
  page_count    INTEGER NOT NULL,
  done_date     TEXT,                       -- ISO date when completed; NULL = pending
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (membership_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_periods_membership ON reading_periods (membership_id);
CREATE INDEX IF NOT EXISTS idx_periods_due ON reading_periods (due_date);
