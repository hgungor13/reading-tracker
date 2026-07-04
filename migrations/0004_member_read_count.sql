-- Milestone 10: "pages to read" moves from the plan (shared) onto each member's
-- slice (per-person). Each reader can read a different number of pages per
-- period; the start-page jump (reading_plans.page_step) stays shared.
-- Plan.pages_per_period stays as the fallback/default when a member hasn't set
-- their own (e.g. the example schedule for a reader with no slice).

ALTER TABLE memberships ADD COLUMN pages_per_period INTEGER; -- per-reader read count; NULL => fall back to plan.pages_per_period
