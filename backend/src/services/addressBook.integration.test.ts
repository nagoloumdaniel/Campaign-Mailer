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
 * Its rules live in SQL: the owner check in every statement, the draft check
 * inside the write, the duplicate refused by the unique index, the order of
 * each sort. A fake would only repeat what the test assumes.
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
let otherUserId: string
let draftId: string
let launchedId: string
let theirsId: string

const NOBODY = '00000000-0000-4000-8000-000000000000'

const query = (overrides: Partial<AddressBookQuery> = {}): AddressBookQuery => ({
  sort: 'company',
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
  otherUserId = users[1].id

  const { rows: campaigns } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, status) VALUES
       ($1, 'Brouillon', 'draft'), ($1, 'Lancée', 'running'), ($2, 'La leur', 'draft')
     RETURNING id`,
    [userId, otherUserId],
  )
  assert.ok(campaigns[0] && campaigns[1] && campaigns[2])
  draftId = campaigns[0].id
  launchedId = campaigns[1].id
  theirsId = campaigns[2].id

  await pool.query(
    `INSERT INTO contacts (campaign_id, email, contact_name, company_name, status, source) VALUES
       ($1, 'zoe@example.test', 'Zoé', 'acme', 'pending', 'csv'),
       ($1, 'bob@example.test', 'Bob', 'Globex', 'pending', 'mailfind'),
       ($2, 'ana@example.test', 'Ana', 'Acme', 'sent', 'csv'),
       ($2, 'nemo@example.test', NULL, NULL, 'pending', 'manual'),
       ($3, 'them@example.test', 'Eux', 'Aardvark', 'pending', 'csv')`,
    [draftId, launchedId, theirsId],
  )
})

after(async () => {
  if (!enabled) {
    return
  }

  // The cascade takes the campaigns and the contacts with the accounts.
  await pool.query('DELETE FROM users WHERE google_id = ANY($1)', [
    [googleId, otherGoogleId],
  ])
  await pool.end()
})

describe(
  'the address book',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('lists every campaign’s contacts of the account, and no one else’s', async () => {
      const { contacts, total } = await book.list(userId, query())

      assert.equal(total, 4)
      assert.ok(contacts.every((row) => row.email !== 'them@example.test'))
    })

    it('sorts by company without regard to case, empty companies last', async () => {
      const { contacts } = await book.list(userId, query({ sort: 'company' }))

      assert.deepEqual(
        contacts.map((row) => row.email),
        ['ana@example.test', 'zoe@example.test', 'bob@example.test', 'nemo@example.test'],
      )
    })

    it('keeps empty companies last when the order is reversed', async () => {
      const { contacts } = await book.list(
        userId,
        query({ sort: 'company', order: 'desc' }),
      )

      assert.equal(contacts[0]?.email, 'bob@example.test')
      assert.equal(contacts.at(-1)?.email, 'nemo@example.test')
    })

    it('sorts by name, by address and by campaign', async () => {
      const byName = await book.list(userId, query({ sort: 'name' }))
      assert.deepEqual(
        byName.contacts.map((row) => row.contact_name),
        ['Ana', 'Bob', 'Zoé', null],
      )

      const byEmail = await book.list(userId, query({ sort: 'email', order: 'desc' }))
      assert.equal(byEmail.contacts[0]?.email, 'zoe@example.test')

      const byCampaign = await book.list(userId, query({ sort: 'campaign' }))
      assert.equal(byCampaign.contacts[0]?.campaign_name, 'Brouillon')
    })

    it('searches an address, a name, a company or a campaign name', async () => {
      assert.equal((await book.list(userId, query({ search: 'GLOB' }))).total, 1)
      assert.equal((await book.list(userId, query({ search: 'lancée' }))).total, 2)
      // A LIKE wildcard in the search is the character, not a pattern.
      assert.equal((await book.list(userId, query({ search: '%' }))).total, 0)
    })

    it('filters on status, source and campaign, and pages', async () => {
      assert.equal((await book.list(userId, query({ status: 'sent' }))).total, 1)
      assert.equal((await book.list(userId, query({ source: 'mailfind' }))).total, 1)
      assert.equal((await book.list(userId, query({ campaignId: launchedId }))).total, 2)

      const second = await book.list(userId, query({ limit: 3, offset: 3 }))
      assert.equal(second.total, 4)
      assert.equal(second.contacts.length, 1)
    })

    it('adds a contact to a draft, marked as typed by hand, and counts it', async () => {
      const outcome = await book.add(userId, draftId, details('new@example.test'))

      assert.equal(outcome.kind, 'saved')
      assert.equal(outcome.contact.source, 'manual')

      const { rows } = await pool.query<{ total_contacts: number }>(
        'SELECT total_contacts FROM campaigns WHERE id = $1',
        [draftId],
      )
      assert.equal(rows[0]?.total_contacts, 3)
    })

    it('refuses a launched campaign, a duplicate, and another account’s campaign', async () => {
      assert.equal(
        (await book.add(userId, launchedId, details('late@example.test'))).kind,
        'not_editable',
      )
      assert.equal(
        (await book.add(userId, draftId, details('ZOE@example.test'))).kind,
        'duplicate',
      )
      assert.equal(
        (await book.add(userId, theirsId, details('x@example.test'))).kind,
        'not_found',
      )
    })

    it('edits a contact of a draft, and not one of a launched campaign', async () => {
      const { contacts } = await book.list(userId, query({ search: 'bob@' }))
      const bob = contacts[0]
      assert.ok(bob)

      const edited = await book.update(
        userId,
        bob.id,
        details('robert@example.test', {
          contact_name: 'Robert',
          company_name: 'Globex',
        }),
      )
      assert.equal(edited.kind, 'saved')
      assert.equal(edited.contact.email, 'robert@example.test')

      const { contacts: launched } = await book.list(userId, query({ search: 'nemo@' }))
      assert.ok(launched[0])
      assert.equal(
        (await book.update(userId, launched[0].id, details('nemo2@example.test'))).kind,
        'not_editable',
      )
      assert.equal(
        (await book.update(userId, NOBODY, details('a@example.test'))).kind,
        'not_found',
      )
    })

    it('removes a contact whatever its campaign’s state, never another account’s', async () => {
      const { contacts } = await book.list(userId, query({ search: 'ana@' }))
      assert.ok(contacts[0])

      const { rows: theirs } = await pool.query<{ id: string }>(
        'SELECT id FROM contacts WHERE campaign_id = $1',
        [theirsId],
      )
      assert.ok(theirs[0])

      assert.equal(await book.remove(userId, theirs[0].id), false)
      assert.equal(await book.remove(userId, contacts[0].id), true)

      const { rows } = await pool.query<{ total_contacts: number }>(
        'SELECT total_contacts FROM campaigns WHERE id = $1',
        [launchedId],
      )
      assert.equal(rows[0]?.total_contacts, 1)
    })
  },
)
