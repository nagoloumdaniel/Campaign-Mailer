-- Sending only happens during office hours: 10:00 to 17:59, local to the
-- campaign's own time zone.
--
-- The rule is the owner's, decided on 16 September 2026, and it is about how
-- the message is received rather than about Gmail's limits. A candidature that
-- lands at 03:00 reads as automated, and a recipient who answers it finds the
-- sender asleep. The planner enforces both ends of the window; this constraint
-- makes the stored start hour unable to sit outside it in the first place.
--
-- Existing rows are pulled inside the window before the constraint is
-- tightened, or the ALTER would fail on them. A campaign that started earlier
-- than 10:00 takes 10:00; one that started later than 17:00 takes 17:00, which
-- is the nearest hour that still sends the same day.

-- Up Migration

UPDATE campaigns SET start_hour = 10 WHERE start_hour < 10;
UPDATE campaigns SET start_hour = 17 WHERE start_hour > 17;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_start_hour_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_start_hour_check CHECK (start_hour BETWEEN 10 AND 17);

ALTER TABLE campaigns ALTER COLUMN start_hour SET DEFAULT 10;

-- Down Migration

ALTER TABLE campaigns ALTER COLUMN start_hour SET DEFAULT 9;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_start_hour_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_start_hour_check CHECK (start_hour BETWEEN 0 AND 23);
