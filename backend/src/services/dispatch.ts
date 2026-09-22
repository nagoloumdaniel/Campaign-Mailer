import type { Pool } from 'pg'

import { nextOpening } from './campaignStats.js'
import {
  FREED_SLOT_MARGIN_MS,
  LAST_SEND_HOUR,
  isSendDay,
  localHour,
  planDay,
  type PlanOutcome,
} from './planner.js'
import { CLAIM_TIMEOUT, completeIfDone, countSentToday } from './sendEngine.js'

const DAY_MS = 24 * 60 * 60 * 1000

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

export type DispatchOutcome = (
  | PlanOutcome
  | { kind: 'not_dispatchable' }
  | { kind: 'completed' }
  /** Launched for a later day and hour: nothing is planned before it. */
  | { kind: 'scheduled_later' }
) & {
  /**
   * When planning this campaign again will find something to send: the start
   * hour, the next morning, or the moment the account's window frees. The
   * worker plans again at that instant rather than at its next quarter-hour,
   * which is what puts the first message out at 10:00 rather than at 10:13.
   */
  retryAt?: Date
}

interface DispatchRow {
  id: string
  user_id: string
  status: string
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
  send_after: Date | null
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
    `SELECT id, user_id, status, mails_per_day, start_hour, pause_ms, timezone, send_after
     FROM campaigns WHERE id = $1`,
    [campaignId],
  )
  const campaign = rows[0]

  if (!campaign || (campaign.status !== 'scheduled' && campaign.status !== 'running')) {
    return { kind: 'not_dispatchable' }
  }

  // The day and hour the user chose. Checked before anything else, and before
  // the campaign is moved to running, so it reads "programmée" until then.
  if (campaign.send_after && campaign.send_after.getTime() > now.getTime()) {
    return { kind: 'scheduled_later', retryAt: campaign.send_after }
  }

  const hour = localHour(now, campaign.timezone)

  // The next time the window opens: today at the start hour, or the next
  // morning that is not a Sunday.
  const opens = () => nextOpening(now, campaign.timezone, campaign.start_hour)

  if (!isSendDay(now, campaign.timezone)) {
    return { kind: 'closed_day', retryAt: opens() }
  }

  if (hour < campaign.start_hour) {
    // A scheduled campaign waits for its first morning in the user's zone; a
    // running one waits for the next.
    return { kind: 'before_start_hour', retryAt: opens() }
  }

  // Checked before the campaign is moved to running, so a campaign launched at
  // half past seven in the evening still reads as "programmée" until it
  // actually has something to send the next morning.
  if (hour > LAST_SEND_HOUR) {
    return { kind: 'after_send_window', retryAt: opens() }
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

  // The sends themselves rather than their count: each one frees a slot of the
  // day's pace 24 hours after it went out, and the plan queues the next send
  // for that second. At most a day's pace of rows, 450 at the very most.
  const inWindow = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM logs
     WHERE campaign_id = $1 AND event_type = 'sent'
       AND created_at >= now() - interval '24 hours'
     ORDER BY created_at`,
    [campaign.id],
  )

  const outcome = planDay({
    now,
    timezone: campaign.timezone,
    startHour: campaign.start_hour,
    mailsPerDay: campaign.mails_per_day,
    pauseMs: campaign.pause_ms,
    sentByCampaign: inWindow.rows.length,
    campaignFreesAt: inWindow.rows.map((row) => row.created_at.getTime() + DAY_MS),
    sentByAccount: await countSentToday(pool, campaign.user_id),
    accountLimit: deps.accountLimit,
    pendingContactIds: pending.rows.map((row) => row.id),
    random: deps.random,
  })

  if (outcome.kind === 'planned') {
    const planned: { contactId: string; at: Date }[] = []

    for (const send of outcome.sends) {
      await deps.enqueueSend(
        { contactId: send.contactId, campaignId: campaign.id, userId: campaign.user_id },
        send.delayMs,
      )
      planned.push({
        contactId: send.contactId,
        at: new Date(now.getTime() + send.delayMs),
      })
    }

    await recordPlannedTimes(pool, planned)
    return outcome
  }

  if (outcome.kind === 'after_send_window' || outcome.kind === 'closed_day') {
    // Everything that fit today is queued; the rest waits for the next opening,
    // which is past the end of today's window.
    const tomorrow = new Date(now.getTime() + 12 * 60 * 60 * 1000)
    return {
      ...outcome,
      retryAt: nextOpening(tomorrow, campaign.timezone, campaign.start_hour),
    }
  }

  if (outcome.kind === 'account_quota_reached') {
    const frees = await accountWindowFreesAt(pool, campaign.user_id)
    return frees ? { ...outcome, retryAt: frees } : outcome
  }

  return outcome
}

/**
 * Writes down when each queued send is due, so the interface can count down to
 * the real second rather than to an estimate.
 *
 * Only over a time that has passed or was never set: a contact planned again
 * while its job already waits in the queue keeps the job's time, because the
 * queue refuses the second job and the first one is what will run.
 */
async function recordPlannedTimes(
  pool: Pool,
  planned: readonly { contactId: string; at: Date }[],
): Promise<void> {
  if (planned.length === 0) {
    return
  }

  await pool.query(
    `UPDATE contacts c SET planned_at = p.at
     FROM unnest($1::uuid[], $2::timestamptz[]) AS p(id, at)
     WHERE c.id = p.id
       AND c.status = 'pending'
       AND (c.planned_at IS NULL OR c.planned_at < now())`,
    [planned.map((send) => send.contactId), planned.map((send) => send.at.toISOString())],
  )
}

/** When the oldest send of the account's 24-hour window leaves it, or null. */
async function accountWindowFreesAt(pool: Pool, userId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ oldest: Date | null }>(
    `SELECT min(l.created_at) AS oldest
     FROM logs l
     JOIN campaigns c ON c.id = l.campaign_id
     WHERE c.user_id = $1
       AND l.event_type = 'sent'
       AND l.created_at >= now() - interval '24 hours'`,
    [userId],
  )

  const oldest = rows[0]?.oldest
  return oldest ? new Date(oldest.getTime() + DAY_MS + FREED_SLOT_MARGIN_MS) : null
}
