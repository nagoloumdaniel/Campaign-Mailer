import type { Pool } from 'pg'

import { logger } from '../logger.js'

/**
 * A record of the actions that matter after the fact.
 *
 * Starting a campaign sends mail from someone's account; exporting and deleting
 * an account are the two data-protection rights. When a user asks "who started
 * this?" or a regulator asks "when was this account erased?", this is the
 * answer.
 *
 * Recording never stops the action it records. An audit row that could not be
 * written is logged, and the user's campaign still starts: refusing a send
 * because a side table is unreachable would be the wrong trade.
 */

/** The fixed list; the database refuses anything else. */
export const AUDIT_ACTIONS = [
  'campaign.started',
  'campaign.paused',
  'campaign.resumed',
  'account.exported',
  'account.deleted',
  'terms.accepted',
  'integration_token.created',
  'integration_token.revoked',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditLog {
  record(actorId: string, action: AuditAction, targetId?: string): Promise<void>
}

export function createAuditLog(pool: Pool): AuditLog {
  return {
    async record(actorId, action, targetId) {
      try {
        await pool.query(
          'INSERT INTO audit_events (actor_id, action, target_id) VALUES ($1, $2, $3)',
          [actorId, action, targetId ?? null],
        )
      } catch (err) {
        // The action and the error, not the actor: a log line is not the place
        // to rebuild the trail this table exists to hold.
        logger.error({ err, action }, 'Audit event could not be recorded')
      }
    },
  }
}
