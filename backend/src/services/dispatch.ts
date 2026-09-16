import type { Pool } from 'pg'

import { LAST_SEND_HOUR, localHour, planDay, type PlanOutcome } from './planner.js'
import { CLAIM_TIMEOUT, completeIfDone, countSentToday } from './sendEngine.js'

/**
 * Turns a campaign's state into send jobs.
 *
 * Runs on a schedule and on demand, and is safe to run as often as it likes:
 * the queue refuses a second job for a contact already queued, and the claim
 * refuses a second send for a contact already taken. Planning twice costs a few
 * queries, never an email.
 */

export interface SendJobData {
  contactId: string
  campaignId: string
  userId: string
}

export interface DispatchDeps {
  pool: Pool
  /** The account's ceiling over a rolling 24 hours. */
  accountLimit: number
  /** Injected so planning is testable without Redis. Must refuse a duplicate id. */
  enqueueSend: (job: SendJobData, delayMs: number) => Promise<void>
  now?: (() => Date) | undefined
  random?: (() => number) | undefined
}

export type DispatchOutcome =
  PlanOutcome | { kind: 'not_dispatchable' } | { kind: 'completed' }

interface DispatchRow {
  id: string
  user_id: string
  status: string
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
}

export async function listDispatchableCampaignIds(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM campaigns WHERE status IN ('scheduled', 'running') ORDER BY created_at`,
  )

  return rows.map((row) => row.id)
}

/** A generous upper bound; the plan never takes more than a day's pace. */
const PENDING_WINDOW = 1500

export async function dispatchCampaign(
  deps: DispatchDeps,
  campaignId: string,
): Promise<DispatchOutcome> {
  const { pool } = deps
  const now = deps.now?.() ?? new Date()

  const { rows } = await pool.query<DispatchRow>(
    `SELECT id, user_id, status, mails_per_day, start_hour, pause_ms, timezone
     FROM campaigns WHERE id = $1`,
    [campaignId],
  )
  const campaign = rows[0]

  if (!campaign || (campaign.status !== 'scheduled' && campaign.status !== 'running')) {
    return { kind: 'not_dispatchable' }
  }

  const hour = localHour(now, campaign.timezone)

  if (hour < campaign.start_hour) {
    // A scheduled campaign waits for its first morning in the user's zone; a
    // running one waits for the next.
    return { kind: 'before_start_hour' }
  }

  // Checked before the campaign is moved to running, so a campaign launched at
  // half past six in the evening still reads as "programmée" until it actually
  // has something to send the next morning.
  if (hour > LAST_SEND_HOUR) {
    return { kind: 'after_send_window' }
  }

  if (campaign.status === 'scheduled') {
    // Conditional, so a pause that lands between the read above and this line
    // wins: the campaign is not dragged back to running.
    const started = await pool.query(
      `UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status = 'scheduled'`,
      [campaign.id],
    )

    if ((started.rowCount ?? 0) === 0) {
      return { kind: 'not_dispatchable' }
    }
  }

  // A contact whose claim went stale is included: a worker died holding it.
  // Left out, it would stay pending forever and the campaign would never
  // complete; taken again, the claim decides whether it is safe to send.
  const pending = await pool.query<{ id: string }>(
    `SELECT id FROM contacts
     WHERE campaign_id = $1
       AND status = 'pending'
       AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TIMEOUT}')
     ORDER BY created_at, id
     LIMIT ${String(PENDING_WINDOW)}`,
    [campaign.id],
  )

  if (pending.rows.length === 0) {
    return (await completeIfDone(pool, campaign.id))
      ? { kind: 'completed' }
      : { kind: 'nothing_pending' }
  }

  const sentByCampaign = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM logs
     WHERE campaign_id = $1 AND event_type = 'sent'
       AND created_at >= now() - interval '24 hours'`,
    [campaign.id],
  )

  const outcome = planDay({
    now,
    timezone: campaign.timezone,
    startHour: campaign.start_hour,
    mailsPerDay: campaign.mails_per_day,
    pauseMs: campaign.pause_ms,
    sentByCampaign: Number(sentByCampaign.rows[0]?.total ?? 0),
    sentByAccount: await countSentToday(pool, campaign.user_id),
    accountLimit: deps.accountLimit,
    pendingContactIds: pending.rows.map((row) => row.id),
    random: deps.random,
  })

  if (outcome.kind === 'planned') {
    for (const send of outcome.sends) {
      await deps.enqueueSend(
        { contactId: send.contactId, campaignId: campaign.id, userId: campaign.user_id },
        send.delayMs,
      )
    }
  }

  return outcome
}
