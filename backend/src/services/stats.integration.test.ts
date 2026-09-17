import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createStatsRepository } from './stats.js'

/**
 * The statistics SQL against the real database: the FILTER clauses, the
 * 24-hour window and the grouping by day in the campaign's zone are exactly the
 * parts a fake cannot get wrong for us.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let campaignId: string
let userId: string
const stamp = Date.now()

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

  const user = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`stats-itest-${String(stamp)}`, `stats-itest-${String(stamp)}@example.test`],
  )
  userId = user.rows[0]?.id ?? ''
  const campaign = await pool.query<{ id: string }>(
    "INSERT INTO campaigns (user_id, name, status) VALUES ($1, 'Stats', 'running') RETURNING id",
    [userId],
  )
  const created = campaign.rows[0]
  assert.ok(created)
  campaignId = created.id

  const contact = async (email: string, status: string) => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO contacts (campaign_id, email, status) VALUES ($1, $2, $3) RETURNING id',
      [campaignId, email, status],
    )
    return rows[0]?.id
  }

  const a = await contact('a@exemple.fr', 'sent')
  const b = await contact('b@exemple.fr', 'sent')
  const c = await contact('c@exemple.fr', 'failed')
  await contact('d@exemple.fr', 'pending')
  await contact('e@exemple.fr', 'pending')
  await contact('f@exemple.fr', 'ignored')

  const log = (contactId: string | null | undefined, type: string, at: string) =>
    pool.query(
      'INSERT INTO logs (campaign_id, contact_id, event_type, created_at) VALUES ($1, $2, $3, $4)',
      [campaignId, contactId ?? null, type, at],
    )

  // 23:30 UTC on 1 July is 01:30 on 2 July in Paris.
  await log(a, 'sent', '2026-07-01T23:30:00Z')
  // Recent, so inside the 24-hour window whenever the test runs.
  await log(b, 'sent', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  await log(c, 'error', '2026-07-01T10:00:00Z')
  // A pause reason: an error with no contact, which is not a failed send.
  await log(null, 'error', '2026-07-01T11:00:00Z')
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query("DELETE FROM users WHERE google_id LIKE 'stats-itest-%'")
  await pool.end()
})

describe(
  'the statistics queries',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('counts contacts by status', async () => {
      const counts = await createStatsRepository(pool).contactCounts(campaignId)

      assert.deepEqual(counts, { total: 6, sent: 2, failed: 1, pending: 2, ignored: 1 })
    })

    it('reads the 24-hour window from the sent logs only', async () => {
      const window = await createStatsRepository(pool).sendWindow(campaignId)

      assert.equal(window.sentLast24h, 1)
      assert.ok(window.oldestInWindowAt instanceof Date)
      assert.ok(window.lastSentAt instanceof Date)
      assert.equal(window.lastSentAt.getTime(), window.oldestInWindowAt.getTime())
    })

    it('groups sends by day in the campaign’s zone, and ignores pause reasons', async () => {
      const days = await createStatsRepository(pool).sendsPerDay(
        campaignId,
        'Europe/Paris',
      )
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(
        new Date(Date.now() - 60 * 60 * 1000),
      )

      assert.deepEqual(days, [
        { day: '2026-07-01', sent: 0, failed: 1 },
        { day: '2026-07-02', sent: 1, failed: 0 },
        { day: today, sent: 1, failed: 0 },
      ])
    })

    it('puts the same send on the UTC day when asked for UTC', async () => {
      const days = await createStatsRepository(pool).sendsPerDay(campaignId, 'UTC')

      assert.deepEqual(days.slice(0, 1), [{ day: '2026-07-01', sent: 1, failed: 1 }])
    })

    it('draws the account’s last two weeks day by day, quiet days included', async () => {
      const days = await createStatsRepository(pool).accountSendsPerDay(
        userId,
        'Europe/Paris',
        14,
      )

      // Every day is there, oldest first, so a sparkline never skips silence.
      assert.equal(days.length, 14)
      assert.deepEqual(
        days.map((day) => day.day),
        [...days.map((day) => day.day)].sort(),
      )
      // The recent send counts; the July one is outside the window, and the
      // error is not a send.
      assert.equal(
        days.reduce((sum, day) => sum + day.sent, 0),
        1,
      )
    })
  },
)
