-- When each queued send is due.
--
-- The plan queues a day's sends at once, each with its own delay, and until
-- now that time lived only in the queue. The interface counted down to an
-- estimate instead, which could be off by the jitter between two sends or by
-- the fifteen minutes between two plans. The dispatcher now writes the due
-- time here as it queues the job, and the next-send countdown reads it.
--
-- Nullable, and never read as a rule: a contact with no planned time is simply
-- one the planner has not reached yet. The partial index serves the one query
-- that reads it, the earliest pending send of a campaign.

-- Up Migration

ALTER TABLE contacts ADD COLUMN planned_at timestamptz;

CREATE INDEX contacts_planned_idx ON contacts (campaign_id, planned_at)
  WHERE status = 'pending' AND planned_at IS NOT NULL;

-- Down Migration

DROP INDEX contacts_planned_idx;

ALTER TABLE contacts DROP COLUMN planned_at;
