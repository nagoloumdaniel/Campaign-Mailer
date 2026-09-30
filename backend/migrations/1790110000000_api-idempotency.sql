-- Idempotency keys of the v1 API (roadmap, Phase 9, MailFind integration).
--
-- Every creation through the API carries an Idempotency-Key. A request sent
-- again under the same key, after a timeout or a lost answer, receives the
-- first response instead of creating a second draft. The response is kept 24
-- hours; `status_code` is null while the first request is still running.

-- Up Migration

CREATE TABLE api_idempotency_keys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key           text        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  -- Method, path and body: the same key for another request is the caller's
  -- mistake, not a repetition.
  request_hash  text        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status_code   smallint,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX api_idempotency_keys_created_idx ON api_idempotency_keys (created_at);

-- Down Migration

DROP TABLE IF EXISTS api_idempotency_keys;
