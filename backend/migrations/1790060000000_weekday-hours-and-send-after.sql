-- Sending hours: Monday to Saturday, 09:00 to 18:59. A launch may be scheduled.
--
-- Decided by the owner on 22 September 2026, replacing the 10:00 to 17:59,
-- every day, of 16 September. Three settings stop being the user's:
--
--   * the start hour is the opening of the window, 09:00, for every campaign.
--     A column that can only hold one value keeps the planner's arithmetic
--     unchanged and the constraint says so.
--   * the pause between two sends is the application's, 30 seconds plus
--     jitter: it is an anti-spam measure, and a setting invites shortening it.
--     Campaigns still to send take the default.
--   * the time zone is the browser's, sent at creation and at launch.
--
-- `send_after` is when the user asked the campaign to start: nothing is planned
-- before it. Null means as soon as the window allows. `scheduled_at` keeps its
-- meaning, the moment the user pressed launch.

-- Up Migration

ALTER TABLE campaigns ADD COLUMN send_after timestamptz;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_start_hour_check;
UPDATE campaigns SET start_hour = 9;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_start_hour_check CHECK (start_hour = 9);
ALTER TABLE campaigns ALTER COLUMN start_hour SET DEFAULT 9;

UPDATE campaigns SET pause_ms = 30000 WHERE status <> 'completed';

-- Down Migration

ALTER TABLE campaigns DROP CONSTRAINT campaigns_start_hour_check;
UPDATE campaigns SET start_hour = 10;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_start_hour_check CHECK (start_hour BETWEEN 10 AND 17);
ALTER TABLE campaigns ALTER COLUMN start_hour SET DEFAULT 10;

ALTER TABLE campaigns DROP COLUMN send_after;
