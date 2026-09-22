import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  createAddressBookRepository,
  type AddressBookQuery,
  type AddressBookRepository,
} from './addressBook.js'

/**
 * The address book against a real PostgreSQL.
 *
 * Its rules live in SQL: the trigger that files every new recipient under one
 * entry per address, the owner check in every statement, the edit that reaches
 * only the sends to come, the removal that never touches history. A fake would
 * only repeat what the test assumes.
 *
 * Skipped when DATABASE_URL is absent. Rows are removed by their exact Google
 * id, so a file running beside this one keeps its own.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const stamp = `${String(Date.now())}-${String(process.pid)}`
const googleId = `itest-book-${stamp}`
const otherGoogleId = `itest-book-other-${stamp}`

let pool: pg.Pool
let book: AddressBookRepository
let userId: string
let draftId: string
let runningId: string
let theirsId: string

const query = (overrides: Partial<AddressBookQuery> = {}): AddressBookQuery => ({
  sort: 'name',
  order: 'asc',
  limit: 50,
  offset: 0,
  ...overrides,
})

const details = (email: string, fields: Record<string, string | null> = {}) => ({
  email,
  contact_name: null,
  company_name: null,
  salutation: null,
  ...fields,
})

async function entryId(email: string): Promise<string> {
  const { contacts } = await book.list(userId, query({ search: email }))
  const found = contacts.find((row) => row.email === email)
  assert.ok(found, `${email} should be in the book`)
  return found.id
}

async function recipients(campaignId: string) {
  const { rows } = await pool.query<{
    email: string
    contact_name: string | null
    company_name: string | null
    status: string
    book_id: string | null
  }>(
    `SELECT email, contact_name, company_name, status, book_id
     FROM contacts WHERE campaign_id = $1 ORDER BY email`,
    [campaignId],
  )
  return rows
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  book = createAddressBookRepository(pool)

  const { rows: users } = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [
      googleId,
      `${googleId}@example.test`,
      otherGoogleId,
      `${otherGoogleId}@example.test`,
    ],
  )
  assert.ok(users[0] && users[1])
  userId = users[0].id

  const { rows: campaigns } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, status) VALUES
       ($1, 'Brouillon', 'draft'), ($1, 'En cours', 'running'), ($2, 'La leur', 'draft')
     RETURNING id`,
    [userId, users[1].id],
  )
  assert.ok(campaigns[0] && campaigns[1] && campaigns[2])
  draftId = campaigns[0].id
  runningId = campaigns[1].id
  theirsId = campaigns[2].id

  // Plain INSERTs, as every import path makes them: the trigger files them.
  await pool.query(
    `INSERT INTO contacts (campaign_id, email, contact_name, company_name, status, source) VALUES
       ($1, 'zoe@example.test', 'Zoé', 'acme', 'pending', 'csv'),
       ($1, 'bob@example.test', 'Bob', 'Globex', 'pending', 'mailfind'),
       ($2, 'ZOE@example.test', NULL, NULL, 'pending', 'csv'),
       ($2, 'ana@example.test', 'Ana', NULL, 'sent', 'csv'),
       ($3, 'them@example.test', 'Eux', 'Aardvark', 'pending', 'csv')`,
    [draftId, runningId, theirsId],
  )
})

after(async () => {
  if (!enabled) {
    return
  }

  // The cascade takes the campaigns, the contacts and the book with the accounts.
  await pool.query('DELETE FROM users WHERE google_id = ANY($1)', [
    [googleId, otherGoogleId],
  ])
  await pool.end()
})

describe(
  'the address book',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('holds one entry per address, whatever campaign or case brought it', async () => {
      const { contacts, total } = await book.list(userId, query())

      assert.equal(total, 3)
      assert.deepEqual(
        contacts.map((row) => row.email),
        ['ana@example.test', 'bob@example.test', 'zoe@example.test'],
      )
    })

    it('links every recipient to its entry, and fills the recipient’s blanks from it', async () => {
      const running = await recipients(runningId)
      const zoe = running.find((row) => row.email === 'ZOE@example.test')

      assert.ok(zoe?.book_id)
      assert.equal(zoe.book_id, await entryId('zoe@example.test'))
      assert.equal(zoe.contact_name, 'Zoé', 'the import left it empty; the book had it')
    })

    it('keeps an entry’s values on a later import and fills only its empty fields', async () => {
      await pool.query(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name)
       VALUES ($1, 'ana@example.test', 'Anne', 'Acme')`,
        [draftId],
      )

      const { contacts } = await book.list(userId, query({ search: 'ana@' }))
      const [ana] = contacts
      assert.ok(ana)
      assert.equal(ana.contact_name, 'Ana', 'a known name is not overwritten')
      assert.equal(ana.company_name, 'Acme', 'an empty company is filled')
    })

    it('sorts, searches, filters on origin, pages, and leaves out what a campaign holds', async () => {
      const byCompany = await book.list(userId, query({ sort: 'company', order: 'desc' }))
      assert.equal(byCompany.contacts[0]?.email, 'bob@example.test')

      assert.equal((await book.list(userId, query({ search: 'GLOB' }))).total, 1)
      assert.equal((await book.list(userId, query({ search: '%' }))).total, 0)
      assert.equal((await book.list(userId, query({ source: 'mailfind' }))).total, 1)

      const second = await book.list(userId, query({ limit: 2, offset: 2 }))
      assert.equal(second.total, 3)
      assert.equal(second.contacts.length, 1)

      // The running campaign holds Zoé and Ana: only Bob is left to offer it.
      const offered = await book.list(userId, query({ excludeCampaignId: runningId }))
      assert.deepEqual(
        offered.contacts.map((row) => row.email),
        ['bob@example.test'],
      )
    })

    it('adds a contact by hand, once per address and per account', async () => {
      const added = await book.add(
        userId,
        details('new@example.test', { contact_name: 'Nouveau' }),
      )
      assert.equal(added.kind, 'saved')
      assert.equal(added.contact.source, 'manual')

      assert.equal(
        (await book.add(userId, details('NEW@example.test'))).kind,
        'duplicate',
      )
    })

    it('updates the sends to come, and never a message already sent', async () => {
      const zoe = await entryId('zoe@example.test')
      const edited = await book.update(
        userId,
        zoe,
        details('zoe.martin@example.test', {
          contact_name: 'Zoé Martin',
          company_name: 'Acme',
        }),
      )
      assert.equal(edited.kind, 'saved')

      // Pending in both campaigns: both take the new details.
      for (const campaign of [draftId, runningId]) {
        const row = (await recipients(campaign)).find((r) => r.book_id === zoe)
        assert.equal(row?.email, 'zoe.martin@example.test')
        assert.equal(row.contact_name, 'Zoé Martin')
      }

      // Ana was sent to: the running campaign keeps what went out.
      const ana = await entryId('ana@example.test')
      await book.update(
        userId,
        ana,
        details('ana@example.test', { contact_name: 'Ana Lopez' }),
      )
      const sent = (await recipients(runningId)).find((r) => r.book_id === ana)
      assert.equal(sent?.contact_name, 'Ana', 'history is not rewritten')
      const pending = (await recipients(draftId)).find((r) => r.book_id === ana)
      assert.equal(pending?.contact_name, 'Ana Lopez', 'the draft takes the new name')
    })

    it('refuses an address another entry has', async () => {
      const bob = await entryId('bob@example.test')
      assert.equal(
        (await book.update(userId, bob, details('ANA@example.test'))).kind,
        'duplicate',
      )
    })

    it('removes a contact from the sends to come and keeps what was sent', async () => {
      const ana = await entryId('ana@example.test')
      await pool.query(
        `INSERT INTO logs (campaign_id, contact_id, event_type)
       SELECT campaign_id, id, 'sent' FROM contacts WHERE book_id = $1 AND status = 'sent'`,
        [ana],
      )

      assert.equal(await book.remove(userId, ana), true)

      // Gone from the draft, where nothing was sent; still in the running
      // campaign, with its log, unlinked.
      assert.ok(
        (await recipients(draftId)).every((row) => row.email !== 'ana@example.test'),
      )
      const kept = (await recipients(runningId)).find(
        (row) => row.email === 'ana@example.test',
      )
      assert.equal(kept?.status, 'sent')
      assert.equal(kept.book_id, null)

      const { rows } = await pool.query<{ total_contacts: number }>(
        'SELECT total_contacts FROM campaigns WHERE id = $1',
        [draftId],
      )
      assert.equal(rows[0]?.total_contacts, (await recipients(draftId)).length)

      // Another account's entry is not found.
      const { rows: theirs } = await pool.query<{ id: string }>(
        "SELECT id FROM address_book WHERE email = 'them@example.test'",
      )
      assert.equal(await book.remove(userId, theirs[0]?.id ?? ana), false)
    })

    it('copies entries into a draft, once per address, never another account’s', async () => {
      const { rows: created } = await pool.query<{ id: string }>(
        "INSERT INTO campaigns (user_id, name) VALUES ($1, 'Cible') RETURNING id",
        [userId],
      )
      const targetId = created[0]?.id ?? ''
      const { rows: theirs } = await pool.query<{ id: string }>(
        "SELECT id FROM address_book WHERE email = 'them@example.test'",
      )
      const ids = [await entryId('bob@example.test'), ...theirs.map((row) => row.id)]

      assert.deepEqual(await book.copyToCampaign(userId, targetId, ids), {
        kind: 'copied',
        imported: 1,
      })
      assert.deepEqual(await book.copyToCampaign(userId, targetId, ids), {
        kind: 'copied',
        imported: 0,
      })
      assert.equal(
        (await book.copyToCampaign(userId, runningId, ids)).kind,
        'not_editable',
      )
      assert.equal((await book.copyToCampaign(userId, theirsId, ids)).kind, 'not_found')

      const copied = await recipients(targetId)
      assert.equal(copied[0]?.book_id, ids[0])
    })
  },
)
