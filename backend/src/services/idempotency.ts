import { createHash } from 'node:crypto'

import type { Pool } from 'pg'

/**
 * Idempotency keys of the v1 API.
 *
 * MailFind sends a selection in batches, each under its own key. A batch sent
 * again after a lost answer must not import its contacts twice or create a
 * second draft: the first response is replayed instead. A server error is not
 * kept, so the call can really be retried.
 */

export const IDEMPOTENCY_RETENTION = '24 hours'

export type Claim =
  | { kind: 'claimed'; id: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' }

export interface IdempotencyRepository {
  claim(userId: string, key: string, requestHash: string): Promise<Claim>
  complete(id: string, status: number, body: unknown): Promise<void>
  release(id: string): Promise<void>
  purgeExpired(): Promise<number>
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path}\n${JSON.stringify(body ?? null)}`, 'utf8')
    .digest('hex')
}

export function createIdempotencyRepository(pool: Pool): IdempotencyRepository {
  return {
    async claim(userId, key, hash) {
      // A key older than the retention is forgotten and may serve again.
      await pool.query(
        `DELETE FROM api_idempotency_keys
          WHERE user_id = $1 AND key = $2
            AND created_at < now() - interval '${IDEMPOTENCY_RETENTION}'`,
        [userId, key],
      )
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO api_idempotency_keys (user_id, key, request_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING
         RETURNING id`,
        [userId, key, hash],
      )
      const id = inserted.rows[0]?.id

      if (id) {
        return { kind: 'claimed', id }
      }

      const { rows } = await pool.query<{
        request_hash: string
        status_code: number | null
        response_body: unknown
      }>(
        `SELECT request_hash, status_code, response_body
           FROM api_idempotency_keys WHERE user_id = $1 AND key = $2`,
        [userId, key],
      )
      const row = rows[0]

      if (row && row.request_hash !== hash) {
        return { kind: 'mismatch' }
      }

      const status = row?.status_code ?? null

      if (row === undefined || status === null) {
        return { kind: 'in_progress' }
      }

      return { kind: 'replay', status, body: row.response_body }
    },

    async complete(id, status, body) {
      await pool.query(
        `UPDATE api_idempotency_keys SET status_code = $2, response_body = $3::jsonb
          WHERE id = $1`,
        [id, status, JSON.stringify(body ?? null)],
      )
    },

    async release(id) {
      await pool.query(
        'DELETE FROM api_idempotency_keys WHERE id = $1 AND status_code IS NULL',
        [id],
      )
    },

    async purgeExpired() {
      const result = await pool.query(
        `DELETE FROM api_idempotency_keys
          WHERE created_at < now() - interval '${IDEMPOTENCY_RETENTION}'`,
      )
      return result.rowCount ?? 0
    },
  }
}
