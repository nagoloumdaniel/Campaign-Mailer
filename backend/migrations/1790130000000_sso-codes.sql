-- Sign in with MailFind, both ways (MailFind decision D-26).
--
-- As MailFind's identity provider, this application issues a one-time code
-- that MailFind then trades, server to server, for the account's Google id
-- and address. Only the SHA-256 of the code is kept: 32 random bytes cannot be
-- guessed, and a leaked table yields no usable code. One minute, one use.

-- Up Migration

CREATE TABLE sso_codes (
  code_hash  text        PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sso_codes_expires_idx ON sso_codes (expires_at);

-- Down Migration

DROP TABLE IF EXISTS sso_codes;
