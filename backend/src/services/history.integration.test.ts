import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createHistoryRepository, type HistoryRepository } from './history.js'

/**
 * The history SQL against the real database.
 *
 * Four things a fake cannot get wrong for us, and all four are the point of
 * this page: it reads the send log rather than the contacts, so a follow-up's
 * recipients are not counted twice; it drops an error with no contact, which
 * is a pause reason and not a message that failed to reach anyone; it is
 * scoped by owner, so another account's sends are invisible; and the per-type
 * tallies ignore the type filter, so the tabs still show what the other tabs
 * hold.
 *
 * The rows are created under one stamped id and deleted by that exact id: a
 * cleanup by a shared prefix would take the accounts of a neighbouring file
 * running beside this one.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let history: HistoryRepository
let userId: string
let strangerId: string
let prospectionId: string
let relanceId: string
let anaContactId: string

const stamp = `history-itest-${String(Date.now())}-${String(process.pid)}`

async function newUser(suffix: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`${stamp}-${suffix}`, `${stamp}-${suffix}@example.test`],
  )

  const created = rows[0]
  assert.ok(created)
  return created.id
}

async function newCampaign(
  owner: string,
  name: string,
  type: string,
  subject: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, type, subject, status)
     VALUES ($1, $2, $3::campaign_type, $4, 'completed') RETURNING id`,
    [owner, name, type, subject],
  )

  const created = rows[0]
  assert.ok(created)
  return created.id
}

async function newContact(
  campaignId: string,
  email: string,
  name: string | null,
  company: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO contacts (campaign_id, email, contact_name, company_name, status)
     VALUES ($1, $2, $3, $4, 'sent') RETURNING id`,
    [campaignId, email, name, company],
  )

  const created = rows[0]
  assert.ok(created)
  return created.id
}

function log(
  campaignId: string,
  contactId: string | null,
  type: 'sent' | 'error',
  at: string,
  message: string | null = null,
) {
  return pool.query(
    `INSERT INTO logs (campaign_id, contact_id, event_type, message, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [campaignId, contactId, type, message, at],
  )
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  history = createHistoryRepository(pool)

  userId = await newUser('owner')
  strangerId = await newUser('stranger')

  prospectionId = await newCampaign(
    userId,
    'Candidatures septembre',
    'prospection',
    'Candidature spontanée',
  )
  relanceId = await newCampaign(userId, 'Relance octobre', 'relance', 'Petite relance')

  anaContactId = await newContact(prospectionId, 'ana@exemple.fr', 'Ana', 'Acme')
  const bob = await newContact(prospectionId, 'bob@exemple.fr', 'Bob', 'Globex')
  const anaAgain = await newContact(relanceId, 'ana@exemple.fr', 'Ana', 'Acme')

  await log(prospectionId, anaContactId, 'sent', '2026-09-01T10:00:00Z')
  await log(prospectionId, bob, 'error', '2026-09-01T11:00:00Z', 'Adresse inconnue')
  // A pause reason, not a message that failed to reach anyone.
  await log(prospectionId, null, 'error', '2026-09-01T11:30:00Z', 'Token expiré')
  await log(relanceId, anaAgain, 'sent', '2026-09-10T09:00:00Z')

  // Another account's send, which must never appear.
  const strangerCampaign = await newCampaign(
    strangerId,
    'Chez quelqu’un d’autre',
    'marketing',
    'Newsletter',
  )
  const strangerContact = await newContact(
    strangerCampaign,
    'someone@exemple.fr',
    'Someone',
    'Elsewhere',
  )
  await log(strangerCampaign, strangerContact, 'sent', '2026-09-05T10:00:00Z')
})

after(async () => {
  if (!enabled) {
    return
  }

  await pool.query('DELETE FROM users WHERE google_id LIKE $1', [`${stamp}-%`])
  await pool.end()
})

describe(
  'the history queries',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    const page = (query: Parameters<HistoryRepository['list']>[1]) =>
      history.list(userId, query)

    it('lists the account’s messages newest first, and nobody else’s', async () => {
      const result = await page({ limit: 50, offset: 0 })

      assert.equal(result.total, 3)
      assert.deepEqual(
        result.rows.map((row) => row.email),
        ['ana@exemple.fr', 'bob@exemple.fr', 'ana@exemple.fr'],
      )
      assert.ok(
        !result.rows.some((row) => row.email === 'someone@exemple.fr'),
        'another account’s send leaked into the history',
      )
    })

    it('drops an error with no contact: a pause reason is not a failed send', async () => {
      const result = await page({ limit: 50, offset: 0 })

      assert.ok(result.rows.every((row) => row.contact_id !== null))
      assert.ok(!result.rows.some((row) => row.message === 'Token expiré'))
    })

    it('counts one row per delivery, so a follow-up is not double counted', async () => {
      const result = await page({ limit: 50, offset: 0 })
      const toAna = result.rows.filter((row) => row.email === 'ana@exemple.fr')

      assert.equal(toAna.length, 2)
      assert.deepEqual(toAna.map((row) => row.campaign_name).sort(), [
        'Candidatures septembre',
        'Relance octobre',
      ])
    })

    it('carries the campaign’s name, type and subject on every row', async () => {
      const [first] = (await page({ limit: 1, offset: 0 })).rows

      assert.ok(first)
      assert.equal(first.campaign_name, 'Relance octobre')
      assert.equal(first.campaign_type, 'relance')
      assert.equal(first.campaign_subject, 'Petite relance')
      assert.equal(first.salutation, null)
      assert.equal(first.outcome, 'sent')
    })

    it('reports the outcome as sent or failed, never as an event type', async () => {
      const failed = (await page({ limit: 50, offset: 0, outcome: 'failed' })).rows
      const [only] = failed

      assert.equal(failed.length, 1)
      assert.ok(only)
      assert.equal(only.outcome, 'failed')
      assert.equal(only.message, 'Adresse inconnue')
    })

    it('filters by campaign type', async () => {
      const result = await page({ limit: 50, offset: 0, type: 'relance' })

      assert.equal(result.total, 1)
      assert.equal(result.rows[0]?.campaign_name, 'Relance octobre')
    })

    it('filters by campaign', async () => {
      const result = await page({ limit: 50, offset: 0, campaignId: prospectionId })

      assert.equal(result.total, 2)
    })

    it('searches an address, a name, a company or a campaign', async () => {
      for (const [needle, expected] of [
        ['globex', 1],
        ['ana@', 2],
        ['relance octobre', 1],
        ['acme', 2],
        ['introuvable', 0],
      ] as const) {
        const result = await page({ limit: 50, offset: 0, search: needle })
        assert.equal(result.total, expected, needle)
      }
    })

    it('keeps the per-type tallies whatever type is filtered on', async () => {
      // A user looking at the relance tab still has to see that the others
      // hold something, or the tabs read as empty.
      const result = await page({ limit: 50, offset: 0, type: 'relance' })

      assert.equal(result.byType.prospection, 2)
      assert.equal(result.byType.relance, 1)
      assert.equal(result.byType.marketing, 0)
    })

    it('pages without losing the order', async () => {
      const first = await page({ limit: 2, offset: 0 })
      const second = await page({ limit: 2, offset: 2 })

      assert.equal(first.rows.length, 2)
      assert.equal(second.rows.length, 1)
      assert.equal(second.total, 3)
      assert.ok(
        !first.rows.some((row) => row.id === second.rows[0]?.id),
        'a row appeared on two pages',
      )
    })

    it('returns every row for the export, filters included', async () => {
      const all = await history.all(userId, {})
      const failed = await history.all(userId, { outcome: 'failed' })

      assert.equal(all.length, 3)
      assert.equal(failed.length, 1)
    })
  },
)
