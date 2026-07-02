-- Milestone 2: per-person assigned slices + a loose daily pace.
-- Each member owns a page range in the book and a rough pages/day pace.
-- Kept as columns on `memberships` (simple, evolvable); a separate
-- `assignments` table can come later if non-contiguous slices are needed.

ALTER TABLE memberships ADD COLUMN pages_per_day INTEGER;   -- rough pace; NULL = use plan default
ALTER TABLE memberships ADD COLUMN assigned_from INTEGER;   -- start of this member's slice (inclusive)
ALTER TABLE memberships ADD COLUMN assigned_to INTEGER;     -- end of this member's slice (inclusive)
ALTER TABLE memberships ADD COLUMN slice_note TEXT;         -- optional free label, e.g. "Temmuz: 30-60"
