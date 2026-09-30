-- What MailFind knows about a contact it sends (roadmap, Phase 9).
--
-- MailFind keeps the source of every address and its verification status.
-- It sends both with each contact, so the campaign shows where an address was
-- found and the planned recipient verification can skip an address MailFind
-- checked less than 30 days ago. A contact from a CSV file or typed by hand
-- leaves the three columns empty.
--
-- The status is MailFind's own vocabulary, a closed list: `valid` is the only
-- one that says a mailbox was confirmed. `accept_all`, `risky`, `unknown` and
-- `unverified` never mean verified. MailFind never sends an invalid,
-- disposable or suppressed address, so those are refused here.

-- Up Migration

ALTER TABLE contacts
  ADD COLUMN source_url text
    CONSTRAINT contacts_source_url_check
    CHECK (source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~ '^https?://')),
  ADD COLUMN verification_status text
    CONSTRAINT contacts_verification_status_check
    CHECK (verification_status IN ('valid', 'accept_all', 'risky', 'unknown', 'unverified')),
  ADD COLUMN verified_at timestamptz;

-- Down Migration

ALTER TABLE contacts
  DROP COLUMN verified_at,
  DROP COLUMN verification_status,
  DROP COLUMN source_url;
