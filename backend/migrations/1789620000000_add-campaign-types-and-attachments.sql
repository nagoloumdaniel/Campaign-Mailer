-- Campaign types, and attachments as rows rather than as two columns.
--
-- Two changes that belong together because both widen what a campaign is.
--
--   * `type` names what the campaign is for. It drives nothing in the send
--     engine; it groups the history and lets a follow-up campaign be told
--     apart from the prospecting run it came from. An enum rather than free
--     text, for the same reason the status is one: a typo would silently
--     create a sixth category nobody filters on.
--   * `campaign_attachments` replaces `attachment_key` / `attachment_name`.
--     A candidature carries a CV and a cover letter, sometimes a transcript;
--     one column could hold one file, and the interface had to call replacing
--     it "Remplacer le fichier". Five is the cap the API enforces — Gmail
--     refuses much past ten megabytes in total once base64 inflates it.
--
-- The existing attachment of every campaign becomes the first row of the new
-- table, so no campaign loses its file. Its content type is read back from the
-- generated key, whose extension came from the upload allowlist; the size was
-- never stored, so it stays null and the interface omits it for those.

-- Up Migration

CREATE TYPE campaign_type AS ENUM (
  'prospection',
  'relance',
  'marketing',
  'alternance',
  'autre'
);

ALTER TABLE campaigns ADD COLUMN type campaign_type NOT NULL DEFAULT 'autre';

-- The history groups by type for one user at a time.
CREATE INDEX campaigns_user_id_type_idx ON campaigns (user_id, type);


CREATE TABLE campaign_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  -- Object key in the attachment bucket, not a URL. Generated at upload.
  object_key   text        NOT NULL,
  name         text        NOT NULL,
  -- Null for the files uploaded before this table existed.
  size_bytes   integer     CHECK (size_bytes IS NULL OR size_bytes > 0),
  content_type text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The composer reads a campaign's attachments in upload order on every send.
CREATE INDEX campaign_attachments_campaign_id_idx
  ON campaign_attachments (campaign_id, created_at, id);

INSERT INTO campaign_attachments (campaign_id, object_key, name, content_type)
SELECT
  id,
  attachment_key,
  COALESCE(attachment_name, 'piece-jointe'),
  CASE
    WHEN attachment_key LIKE '%.pdf' THEN 'application/pdf'
    WHEN attachment_key LIKE '%.docx'
      THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ELSE 'application/msword'
  END
FROM campaigns
WHERE attachment_key IS NOT NULL;

ALTER TABLE campaigns DROP COLUMN attachment_key;
ALTER TABLE campaigns DROP COLUMN attachment_name;


-- Down Migration

ALTER TABLE campaigns ADD COLUMN attachment_key text;
ALTER TABLE campaigns ADD COLUMN attachment_name text;

-- The oldest attachment goes back into the columns, which is the one that was
-- there before the upgrade. Any later file is dropped with the table: the old
-- shape has nowhere to put it.
UPDATE campaigns c
SET attachment_key = a.object_key,
    attachment_name = a.name
FROM (
  SELECT DISTINCT ON (campaign_id) campaign_id, object_key, name
  FROM campaign_attachments
  ORDER BY campaign_id, created_at, id
) a
WHERE a.campaign_id = c.id;

DROP TABLE campaign_attachments;

DROP INDEX campaigns_user_id_type_idx;
ALTER TABLE campaigns DROP COLUMN type;
DROP TYPE campaign_type;
