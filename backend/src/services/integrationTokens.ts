import { createHash, randomBytes } from 'node:crypto'

import type { Pool } from 'pg'

/**
 * Personal integration tokens, for the v1 API (roadmap, Phase 9).
 *
 * A token is `cm_` followed by 32 random bytes in base64url. It is shown once,
 * when created; only a display prefix and its SHA-256 hash are kept. The `cm_`
 * prefix lets secret scanners recognise one pasted into a repository.
 */

export const INTEGRATION_SCOPES = ['campaigns:write', 'contacts:write'] as const
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]

/** One per connected application is enough; every active token is one more way in. */
export const MAX_ACTIVE_TOKENS = 10

/** The last-used date needs no precision to the second: one write a minute at most. */
const TOUCH_INTERVAL_SECONDS = 60

const SHAPE = /^cm_[A-Za-z0-9_-]{43}$/
const PREFIX_LENGTH = 11

export interface GeneratedToken {
  secret: string
  prefix: string
  hash: string
}

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function generateToken(): GeneratedToken {
  const secret = `cm_${randomBytes(32).toString('base64url')}`
  return { secret, prefix: secret.slice(0, PREFIX_LENGTH), hash: hashToken(secret) }
}

/** A value without a token's shape is refused before any query. */
export function looksLikeToken(value: string): boolean {
  return SHAPE.test(value)
}

/** What the account page shows: never the secret, never the hash. */
export interface IntegrationTokenRow {
  id: string
  name: string
  prefix: string
  scopes: IntegrationScope[]
  last_used_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

export interface ActiveToken {
  id: string
  userId: string
  scopes: IntegrationScope[]
}

export type CreateTokenResult =
  | { kind: 'created'; token: IntegrationTokenRow; secret: string }
  | { kind: 'limit_reached' }

export interface IntegrationTokenRepository {
  create(
    userId: string,
    name: string,
    scopes: IntegrationScope[],
  ): Promise<CreateTokenResult>
  list(userId: string): Promise<IntegrationTokenRow[]>
  /** Null when the token does not exist, is not the user's, or was already revoked. */
  revoke(userId: string, tokenId: string): Promise<IntegrationTokenRow | null>
  /** The active token carrying this hash, on an account that still exists. */
  findActive(hash: string): Promise<ActiveToken | null>
  touch(tokenId: string): Promise<void>
}

const COLUMNS = 'id, name, prefix, scopes, last_used_at, revoked_at, created_at'

export function createIntegrationTokenRepository(pool: Pool): IntegrationTokenRepository {
  return {
    async create(userId, name, scopes) {
      const token = generateToken()
      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        // A lock per account while counting then inserting: without it, two
        // creations at once would each see the last free place.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `integration_tokens:${userId}`,
        ])
        const { rows } = await client.query<IntegrationTokenRow>(
          `INSERT INTO integration_tokens (user_id, name, prefix, token_hash, scopes)
           SELECT $1, $2, $3, $4, $5::text[]
            WHERE (SELECT count(*) FROM integration_tokens
                    WHERE user_id = $1 AND revoked_at IS NULL) < $6
           RETURNING ${COLUMNS}`,
          [
            userId,
            name,
            token.prefix,
            token.hash,
            [...new Set(scopes)],
            MAX_ACTIVE_TOKENS,
          ],
        )
        await client.query('COMMIT')

        const row = rows[0]
        return row
          ? { kind: 'created', token: row, secret: token.secret }
          : { kind: 'limit_reached' }
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    async list(userId) {
      const { rows } = await pool.query<IntegrationTokenRow>(
        `SELECT ${COLUMNS} FROM integration_tokens
          WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
        [userId],
      )
      return rows
    },

    async revoke(userId, tokenId) {
      const { rows } = await pool.query<IntegrationTokenRow>(
        `UPDATE integration_tokens SET revoked_at = now()
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          RETURNING ${COLUMNS}`,
        [tokenId, userId],
      )
      return rows[0] ?? null
    },

    async findActive(hash) {
      // Looked up by the exact hash, indexed: no comparison depends on the
      // secret's value.
      const { rows } = await pool.query<{
        id: string
        user_id: string
        scopes: IntegrationScope[]
      }>(
        `SELECT t.id, t.user_id, t.scopes
           FROM integration_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
        [hash],
      )
      const row = rows[0]
      return row ? { id: row.id, userId: row.user_id, scopes: row.scopes } : null
    },

    async touch(tokenId) {
      await pool.query(
        `UPDATE integration_tokens SET last_used_at = now()
          WHERE id = $1
            AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2))`,
        [tokenId, TOUCH_INTERVAL_SECONDS],
      )
    },
  }
}
