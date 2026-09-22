-- Where each contact came from: a CSV file, typed by hand, or sent by MailFind.
--
-- The address book lists every contact of the account and filters on it, and
-- the MailFind integration (roadmap, Phase 9) needs its contacts told apart
-- from the ones the user imported. Existing rows cannot be told apart after
-- the fact: they are all recorded as 'csv', which is what nearly all of them
-- are. A follow-up campaign copies the source of the contact it copies.

-- Up Migration

ALTER TABLE contacts
  ADD COLUMN source text NOT NULL DEFAULT 'csv'
  CONSTRAINT contacts_source_check CHECK (source IN ('csv', 'manual', 'mailfind'));

-- Down Migration

ALTER TABLE contacts DROP COLUMN source;
