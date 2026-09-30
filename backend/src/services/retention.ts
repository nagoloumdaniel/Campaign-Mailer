import type { Pool } from 'pg'

import { createIdempotencyRepository } from './idempotency.js'

/**
 * How long the application keeps what it records about sending (roadmap #86).
 *
 * Twelve months, then the send logs and the audit events go. Long enough to
 * answer a question about last year's campaign; short enough that the
 * application does not become an archive of who wrote to whom.
 *
 * Only logs and audit events. Campaigns and contacts belong to the user, who
 * deletes them, or their account, when they choose.
 *
 * Purging a campaign's `sent` log does not open the door to sending again: the
 * send engine claims only contacts still `pending`, and a contact that was sent
 * keeps that status after its log line is gone.
 */

export const RETENTION_INTERVAL = '12 months'

export interface PurgeReport {
  logs: number
  auditEvents: number
  /** Idempotency keys of the v1 API past their 24 hours. */
  idempotencyKeys: number
}

export async function purgeExpired(pool: Pool): Promise<PurgeReport> {
  const logs = await pool.query(
    `DELETE FROM logs WHERE created_at < now() - interval '${RETENTION_INTERVAL}'`,
  )
  const auditEvents = await pool.query(
    `DELETE FROM audit_events WHERE created_at < now() - interval '${RETENTION_INTERVAL}'`,
  )

  const idempotencyKeys = await createIdempotencyRepository(pool).purgeExpired()

  return {
    logs: logs.rowCount ?? 0,
    auditEvents: auditEvents.rowCount ?? 0,
    idempotencyKeys,
  }
}
