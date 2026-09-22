import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import pg from 'pg'

import { createComposer } from '../services/composer.js'
import { dispatchCampaign, type SendJobData } from '../services/dispatch.js'
import {
  TransientSendError,
  type SendEngineDeps,
  type SendGateway,
} from '../services/sendEngine.js'
import { ReauthorizationRequiredError } from '../services/tokenRefresh.js'

import {
  REAUTHORIZATION_MESSAGE,
  createSendProcessor,
  failAfterLastAttempt,
} from './processors.js'
import { SEND_ATTEMPTS } from './queues.js'

/**
 * The whole send pipeline against the real database: plan, queue, send, retry,
 * give up, crash, restart.
 *
 * The queue is an in-memory stand-in that behaves like BullMQ where it
 * matters — a second job with the same id is refused, a failed job is retried
 * up to its attempts, a job whose worker died is delivered again. Redis itself
 * is exercised by the smoke test recorded in jobs/connection.ts; what is proved
 * here is that no sequence of those events sends anyone the same email twice.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let userId: string
let campaignId: string
const stamp = Date.now()
let userCounter = 0

interface QueuedJob {
  data: SendJobData
  delayMs: number
  attemptsMade: number
}

/** Refuses a duplicate id, as BullMQ does. */
class FakeQueue {
  readonly jobs = new Map<string, QueuedJob>()
  added = 0

  enqueue = (data: SendJobData, delayMs: number): Promise<void> => {
    if (!this.jobs.has(data.contactId)) {
      this.jobs.set(data.contactId, { data, delayMs, attemptsMade: 0 })
      this.added += 1
    }
    return Promise.resolve()
  }

  next(): QueuedJob | undefined {
    return [...this.jobs.values()].sort((a, b) => a.delayMs - b.delayMs)[0]
  }
}

/** Reads the recipient out of the message Gmail was handed. */
function recipientOf(raw: string): string {
  const match = /^To: (.+)$/m.exec(Buffer.from(raw, 'base64url').toString('utf8'))
  assert.ok(match?.[1], 'no To header in the message')
  return match[1].trim()
}

/** Gmail as far as the pipeline can tell: counts every message that left. */
function mailbox() {
  const delivered: string[] = []
  const refused: string[] = []
  let crashAt: number | null = null
  let transientFor: string | null = null
  let onCrash: () => void = () => undefined

  const gateway: SendGateway = {
    send: (_token, raw) => {
      const to = recipientOf(raw)

      if (to === transientFor) {
        refused.push(to)
        return Promise.reject(new TransientSendError('Gmail answered 503'))
      }

      delivered.push(to)

      if (crashAt !== null && delivered.length === crashAt) {
        // Gmail accepted it; the worker dies before hearing back. Nothing after
        // this line runs, which is exactly the window the engine fears.
        onCrash()
        return new Promise<string>(() => undefined)
      }

      return Promise.resolve(`msg-${String(delivered.length)}`)
    },
  }

  return {
    gateway,
    delivered,
    refused,
    crashAfterDelivering(n: number, handler: () => void) {
      crashAt = n
      onCrash = handler
    },
    refuseTransiently(address: string) {
      transientFor = address
    },
    /** How many times each address received the campaign. */
    counts(): Map<string, number> {
      const counts = new Map<string, number>()
      for (const to of delivered) {
        counts.set(to, (counts.get(to) ?? 0) + 1)
      }
      return counts
    },
  }
}

function engine(
  gateway: SendGateway,
  overrides: Partial<SendEngineDeps> = {},
): SendEngineDeps {
  return {
    pool,
    gateway,
    getAccessToken: () => Promise.resolve('token'),
    compose: createComposer({
      pool,
      readAttachment: () => Promise.resolve(Buffer.alloc(0)),
    }),
    dailyLimit: 1500,
    ...overrides,
  }
}

/**
 * Noon UTC today.
 *
 * Sending only happens between 10:00 and 17:59 on the campaign's own clock —
 * UTC for this fixture — and this suite runs whenever somebody runs it.
 * Pinning the planner's clock to the middle of the window is what keeps these
 * tests about the pipeline rather than about the hour of the day. The two
 * cases that are about the hour pass their own instant.
 */
function noonUtc(): Date {
  const at = new Date()
  at.setUTCHours(12, 0, 0, 0)
  return at
}

async function plan(
  queue: FakeQueue,
  overrides: { accountLimit?: number; now?: Date } = {},
) {
  const { now } = overrides

  return dispatchCampaign(
    {
      pool,
      accountLimit: overrides.accountLimit ?? 1500,
      enqueueSend: queue.enqueue,
      now: () => now ?? noonUtc(),
      random: () => 0,
    },
    campaignId,
  )
}

/**
 * Runs the queue dry the way a worker would. Stops, leaving the job in place as
 * a stalled job would be, if the worker "dies".
 */
async function drain(queue: FakeQueue, deps: SendEngineDeps, crashed?: Promise<void>) {
  const processSend = createSendProcessor(deps)
  const died = crashed?.then(() => 'died' as const)

  for (let job = queue.next(); job; job = queue.next()) {
    const current = job

    try {
      const running = processSend(current.data).then(() => 'done' as const)
      const result = died ? await Promise.race([running, died]) : await running

      if (result === 'died') {
        return 'died'
      }

      queue.jobs.delete(current.data.contactId)
    } catch (err) {
      current.attemptsMade += 1

      if (current.attemptsMade >= SEND_ATTEMPTS) {
        await failAfterLastAttempt(pool, current.data, err as Error)
        queue.jobs.delete(current.data.contactId)
      }
    }
  }

  return 'drained'
}

async function addContacts(n: number): Promise<string[]> {
  const emails = Array.from({ length: n }, (_, i) => `p${String(i)}@exemple.fr`)
  for (const email of emails) {
    await pool.query('INSERT INTO contacts (campaign_id, email) VALUES ($1, $2)', [
      campaignId,
      email,
    ])
  }
  return emails
}

async function campaignRow() {
  const { rows } = await pool.query<{
    status: string
    sent_count: number
    error_count: number
  }>('SELECT status, sent_count, error_count FROM campaigns WHERE id = $1', [campaignId])
  const row = rows[0]
  assert.ok(row)
  return row
}

async function statusCounts(): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ status: string; n: string }>(
    'SELECT status, count(*)::text AS n FROM contacts WHERE campaign_id = $1 GROUP BY status',
    [campaignId],
  )
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]))
}

function assertNobodyTwice(counts: Map<string, number>) {
  for (const [address, times] of counts) {
    assert.equal(times, 1, `${address} received the campaign ${String(times)} times`)
  }
}

before(() => {
  if (enabled) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 })
  }
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query("DELETE FROM users WHERE google_id LIKE 'pipeline-itest-%'")
  await pool.end()
})

beforeEach(async () => {
  if (!enabled) {
    return
  }

  // A user per test: the account ceiling counts across a user's campaigns,
  // and one test's sends must not spend another's allowance.
  userCounter += 1
  const tag = `${String(stamp)}-${String(userCounter)}`
  const user = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`pipeline-itest-${tag}`, `pipeline-${tag}@example.test`],
  )
  assert.ok(user.rows[0])
  userId = user.rows[0].id

  const campaign = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, status, subject, body_html, body_text,
                            mails_per_day, start_hour, timezone)
     VALUES ($1, 'Pipeline', 'running', 'Bonjour {{contact_name|}}', '<p>Bonjour</p>', 'Bonjour',
             450, 10, 'UTC')
     RETURNING id`,
    [userId],
  )
  assert.ok(campaign.rows[0])
  campaignId = campaign.rows[0].id
})

describe(
  'the send pipeline',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('sends 50 contacts exactly once each and completes', async () => {
      const emails = await addContacts(50)
      const queue = new FakeQueue()
      const gmail = mailbox()

      assert.equal((await plan(queue)).kind, 'planned')
      assert.equal(await drain(queue, engine(gmail.gateway)), 'drained')

      assert.equal(gmail.delivered.length, 50)
      assert.deepEqual([...gmail.counts().keys()].sort(), [...emails].sort())
      assertNobodyTwice(gmail.counts())

      const campaign = await campaignRow()
      assert.equal(campaign.status, 'completed')
      assert.equal(campaign.sent_count, 50)

      // Planning a finished campaign again sends nothing.
      assert.equal((await plan(queue)).kind, 'not_dispatchable')
      assert.equal(queue.jobs.size, 0)
    })

    it('adds nothing when the schedule fires twice before the jobs run', async () => {
      await addContacts(20)
      const queue = new FakeQueue()
      const gmail = mailbox()

      await plan(queue)
      await plan(queue)
      await plan(queue)

      assert.equal(queue.added, 20)
      await drain(queue, engine(gmail.gateway))
      assert.equal(gmail.delivered.length, 20)
      assertNobodyTwice(gmail.counts())
    })

    it('sends nobody twice when the worker dies mid-campaign and restarts', async () => {
      await addContacts(50)
      const queue = new FakeQueue()
      const gmail = mailbox()

      let died: () => void = () => undefined
      const crashed = new Promise<void>((resolve) => {
        died = resolve
      })
      gmail.crashAfterDelivering(20, died)

      await plan(queue)
      assert.equal(await drain(queue, engine(gmail.gateway), crashed), 'died')
      assert.equal(gmail.delivered.length, 20)

      // Ten minutes pass: the dead worker's claim expires.
      await pool.query(
        `UPDATE contacts SET claimed_at = claimed_at - interval '11 minutes'
       WHERE campaign_id = $1 AND claimed_at IS NOT NULL`,
        [campaignId],
      )

      // Restart: the stalled job is delivered again, and the schedule plans again.
      const restarted = mailbox()
      await plan(queue)
      assert.equal(await drain(queue, engine(restarted.gateway)), 'drained')

      const everyone = new Map(gmail.counts())
      for (const [address, times] of restarted.counts()) {
        everyone.set(address, (everyone.get(address) ?? 0) + times)
      }
      assertNobodyTwice(everyone)

      // The one Gmail accepted but nobody recorded is reported, not resent.
      assert.equal(restarted.delivered.length, 30)
      assert.deepEqual(await statusCounts(), { sent: 49, failed: 1 })
      assert.equal((await campaignRow()).status, 'completed')

      const unknown = await pool.query<{ email: string; error_message: string }>(
        "SELECT email, error_message FROM contacts WHERE campaign_id = $1 AND status = 'failed'",
        [campaignId],
      )
      assert.equal(unknown.rows[0]?.email, gmail.delivered[19])
      assert.match(unknown.rows[0]?.error_message ?? '', /inconnue/)
    })

    it('stops at the account ceiling without failing or pausing anything', async () => {
      await addContacts(30)
      const queue = new FakeQueue()
      const gmail = mailbox()

      assert.equal((await plan(queue, { accountLimit: 20 })).kind, 'planned')
      assert.equal(queue.added, 20)
      await drain(queue, engine(gmail.gateway, { dailyLimit: 20 }))

      assert.equal(gmail.delivered.length, 20)
      const held = await plan(queue, { accountLimit: 20 })
      assert.equal(held.kind, 'account_quota_reached')
      assert.ok(held.retryAt, 'the plan should say when the window frees')
      assert.equal(queue.jobs.size, 0)

      assert.deepEqual(await statusCounts(), { sent: 20, pending: 10 })
      assert.equal((await campaignRow()).status, 'running', 'the next window resumes it')
    })

    it('holds the ceiling at send time when the plan overshoots it', async () => {
      // A second campaign of the same account may have sent since the plan ran.
      await addContacts(20)
      const queue = new FakeQueue()
      const gmail = mailbox()

      await plan(queue)
      await drain(queue, engine(gmail.gateway, { dailyLimit: 15 }))

      assert.equal(gmail.delivered.length, 15)
      assert.deepEqual(await statusCounts(), { sent: 15, pending: 5 })
    })

    it('pauses once when the token dies mid-campaign, fails nobody, and finishes on resume', async () => {
      await addContacts(10)
      const queue = new FakeQueue()
      const gmail = mailbox()

      let tokens = 0
      const expiring = engine(gmail.gateway, {
        getAccessToken: () => {
          tokens += 1
          return tokens <= 4
            ? Promise.resolve('token')
            : Promise.reject(new ReauthorizationRequiredError('invalid_grant'))
        },
      })

      await plan(queue)
      await drain(queue, expiring)

      assert.equal(gmail.delivered.length, 4)
      assert.equal((await campaignRow()).status, 'paused')
      assert.deepEqual(await statusCounts(), { sent: 4, pending: 6 })

      const reasons = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM logs WHERE campaign_id = $1 AND message = $2',
        [campaignId, REAUTHORIZATION_MESSAGE],
      )
      assert.equal(reasons.rows[0]?.n, '1', 'the reason should be logged once')

      // The user reconnects and resumes.
      await pool.query("UPDATE campaigns SET status = 'running' WHERE id = $1", [
        campaignId,
      ])
      await plan(queue)
      await drain(queue, engine(gmail.gateway))

      assert.equal(gmail.delivered.length, 10)
      assertNobodyTwice(gmail.counts())
      assert.equal((await campaignRow()).status, 'completed')
    })

    it('gives up on an address after its attempts, without holding up the others', async () => {
      const emails = await addContacts(5)
      const queue = new FakeQueue()
      const gmail = mailbox()
      const stubborn = emails[2]
      assert.ok(stubborn)
      gmail.refuseTransiently(stubborn)

      await plan(queue)
      await drain(queue, engine(gmail.gateway))

      assert.equal(gmail.refused.length, SEND_ATTEMPTS)
      assert.equal(gmail.delivered.length, 4)

      const failed = await pool.query<{
        email: string
        attempts: number
        error_message: string
      }>(
        "SELECT email, attempts, error_message FROM contacts WHERE campaign_id = $1 AND status = 'failed'",
        [campaignId],
      )
      const [gaveUp] = failed.rows
      assert.ok(gaveUp)
      assert.equal(gaveUp.email, stubborn)
      assert.equal(gaveUp.attempts, 0, 'refusals are not deliveries')
      assert.match(gaveUp.error_message, /Échec après plusieurs tentatives/)
      assert.equal((await campaignRow()).status, 'completed')
    })

    it('lets the queued jobs of a paused campaign run out empty, and queues them again on resume', async () => {
      await addContacts(10)
      const queue = new FakeQueue()
      const gmail = mailbox()

      await plan(queue)
      await pool.query("UPDATE campaigns SET status = 'paused' WHERE id = $1", [
        campaignId,
      ])
      await drain(queue, engine(gmail.gateway))

      assert.equal(gmail.delivered.length, 0)
      assert.deepEqual(await statusCounts(), { pending: 10 })

      await pool.query("UPDATE campaigns SET status = 'running' WHERE id = $1", [
        campaignId,
      ])
      await plan(queue)
      await drain(queue, engine(gmail.gateway))

      assert.equal(gmail.delivered.length, 10)
      assertNobodyTwice(gmail.counts())
    })

    it('waits for the start hour in the campaign’s zone, then starts', async () => {
      await addContacts(3)
      await pool.query(
        "UPDATE campaigns SET status = 'scheduled', start_hour = 14 WHERE id = $1",
        [campaignId],
      )
      const queue = new FakeQueue()

      // The worker plans again at 14:00 exactly, not at its next quarter-hour.
      assert.deepEqual(await plan(queue, { now: new Date('2026-07-01T10:00:00Z') }), {
        kind: 'before_start_hour',
        retryAt: new Date('2026-07-01T14:00:00Z'),
      })
      assert.equal((await campaignRow()).status, 'scheduled')
      assert.equal(queue.added, 0)

      assert.equal(
        (await plan(queue, { now: new Date('2026-07-01T15:00:00Z') })).kind,
        'planned',
      )
      assert.equal((await campaignRow()).status, 'running')
      assert.equal(queue.added, 3)
    })

    it('queues nothing once the sending window has closed', async () => {
      await addContacts(3)
      await pool.query("UPDATE campaigns SET status = 'scheduled' WHERE id = $1", [
        campaignId,
      ])
      const queue = new FakeQueue()

      // 18:30 UTC, past the last hour a send may begin. A campaign launched
      // in the evening starts the next morning; nothing goes out tonight, and
      // it is still only scheduled.
      assert.deepEqual(await plan(queue, { now: new Date('2026-07-01T18:30:00Z') }), {
        kind: 'after_send_window',
        retryAt: new Date('2026-07-02T10:00:00Z'),
      })
      assert.equal((await campaignRow()).status, 'scheduled')
      assert.equal(queue.added, 0)

      assert.equal(
        (await plan(queue, { now: new Date('2026-07-02T10:30:00Z') })).kind,
        'planned',
      )
      assert.equal(queue.added, 3)
    })
  },
)
