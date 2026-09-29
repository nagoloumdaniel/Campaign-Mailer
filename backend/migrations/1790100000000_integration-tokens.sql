-- Personal integration tokens (roadmap, Phase 9, MailFind integration).
--
-- A token lets another application, MailFind first, create draft campaigns
-- for the account through the v1 API. It is shown once when created and only
-- its SHA-256 hash is kept, with a short prefix to recognise it on the account
-- page. The token is 32 random bytes: a fast hash is enough, since nobody can
-- guess such a value, and a slow one would cost on every call. No Google
-- session is ever shared with the other application.

-- Up Migration

CREATE TABLE integration_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  prefix       text        NOT NULL CHECK (prefix ~ '^cm_[A-Za-z0-9_-]{8}$'),
  token_hash   text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scopes       text[]      NOT NULL CHECK (
    cardinality(scopes) >= 1 AND scopes <@ ARRAY['campaigns:write', 'contacts:write']::text[]
  ),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_tokens_user_idx ON integration_tokens (user_id, created_at DESC);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'campaign.started',
  'campaign.paused',
  'campaign.resumed',
  'account.exported',
  'account.deleted',
  'terms.accepted',
  'integration_token.created',
  'integration_token.revoked'
));

-- Down Migration

-- Rows the narrower constraint would refuse go first.
DELETE FROM audit_events
 WHERE action IN ('integration_token.created', 'integration_token.revoked');

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'campaign.started',
  'campaign.paused',
  'campaign.resumed',
  'account.exported',
  'account.deleted',
  'terms.accepted'
));

DROP TABLE IF EXISTS integration_tokens;
