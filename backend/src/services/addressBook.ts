import type { Pool, PoolClient } from 'pg'

import type { CampaignStatus } from './campaignState.js'
import { formatInZone } from './history.js'
import { csvCell } from './logExport.js'

/**
 * The account's address book: one entry per email address.
 *
 * Owner's design of 22 September 2026. A person is added once, whatever brings
 * them (a CSV file, a manual add, MailFind later), and edited in one place. A
 * campaign's recipients (`contacts`) are a snapshot taken from the book, linked
 * by `book_id`; the trigger in the address-book migration creates the entry
 * when an unknown address is imported and fills only its empty fields when the
 * address is known, so a correction made here is never overwritten by an old
 * file.
 *
 * Editing an entry rewrites the recipients that have not been sent to yet, in
 * any campaign, so the next message uses the new name; a recipient already sent
 * to, or failed, keeps what went out, and the history with it. Removing an
 * entry takes it out of the sends still to come and leaves the history whole:
 * a recipient with a send log is never deleted (deleting one would cascade to
 * its log rows).
 *
 * Every statement filters on the owner in the SQL, so another account's entry
 * is not found rather than forbidden.
 */

export type ContactSource = 'csv' | 'manual' | 'mailfind'

export const ADDRESS_BOOK_SORTS = [
  'name',
  'email',
  'company',
  'created',
  'source',
] as const

export type AddressBookSort = (typeof ADDRESS_BOOK_SORTS)[number]

export interface AddressBookRow {
  id: string
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
  source: ContactSource
  created_at: Date
}

export interface AddressBookQuery {
  /** Matches an address, a name or a company. */
  search?: string | undefined
  source?: ContactSource | undefined
  /** Leaves out the addresses this campaign already holds: what a picker needs. */
  excludeCampaignId?: string | undefined
  sort: AddressBookSort
  order: 'asc' | 'desc'
  limit: number
  offset: number
}

export interface ContactDetails {
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
}

export type WriteOutcome =
  | { kind: 'saved'; contact: AddressBookRow }
  | { kind: 'not_found' }
  /** Another entry of the account already has this address. */
  | { kind: 'duplicate' }

export type CopyOutcome =
  { kind: 'copied'; imported: number } | { kind: 'not_found' } | { kind: 'not_editable' }

export interface AddressBookRepository {
  list(
    userId: string,
    query: AddressBookQuery,
  ): Promise<{ contacts: AddressBookRow[]; total: number }>
  /** Every entry the filters match, in their order, for the export. */
  all(
    userId: string,
    query: Omit<AddressBookQuery, 'limit' | 'offset'>,
  ): Promise<AddressBookRow[]>
  add(userId: string, details: ContactDetails): Promise<WriteOutcome>
  update(userId: string, id: string, details: ContactDetails): Promise<WriteOutcome>
  remove(userId: string, id: string): Promise<boolean>
  /** Copies entries into one of the account's drafts, as recipients. */
  copyToCampaign(
    userId: string,
    campaignId: string,
    ids: readonly string[],
  ): Promise<CopyOutcome>
}

const COLUMNS = `id, email, contact_name, company_name, salutation, source, created_at`

/**
 * The ORDER BY for each sort, from a fixed map: the column name never comes
 * from the request. Text compares without case, an empty name or company goes
 * last whichever the direction, and the id breaks every tie so a page boundary
 * never shows a row twice or skips one.
 */
function orderBy(sort: AddressBookSort, order: 'asc' | 'desc'): string {
  const dir = order === 'desc' ? 'DESC' : 'ASC'

  const keys = new Map<AddressBookSort, string>([
    ['name', `lower(contact_name) ${dir} NULLS LAST, lower(email) ASC`],
    ['email', `lower(email) ${dir}`],
    [
      'company',
      `lower(company_name) ${dir} NULLS LAST, lower(contact_name) ASC NULLS LAST, lower(email) ASC`,
    ],
    ['created', `created_at ${dir}`],
    ['source', `source ${dir}, lower(email) ASC`],
  ])

  return `${keys.get(sort) ?? `lower(email) ${dir}`}, id ${dir}`
}

/** The most rows one export carries: the same bound as the history's. */
const EXPORT_LIMIT = 50_000

/** Written by code point: the character itself is invisible in source and fails the linter. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

const SOURCE_LABELS = new Map<ContactSource, string>([
  ['csv', 'import CSV'],
  ['manual', 'ajout manuel'],
  ['mailfind', 'MailFind'],
])

/**
 * The address book as a CSV: the columns of the page, nothing else.
 *
 * Every cell goes through `csvCell`, which neutralises the leading `=` a
 * spreadsheet would run as a formula: the addresses came from files the user
 * was handed. A BOM so Excel reads the accents; CRLF as RFC 4180 specifies.
 */
export function addressBookToCsv(
  rows: readonly AddressBookRow[],
  timezone: string,
): string {
  const header = ['nom', 'email', 'entreprise', 'civilite', 'ajoute_le', 'origine']
    .map(csvCell)
    .join(',')

  const lines = rows.map((row) =>
    [
      row.contact_name ?? '',
      row.email,
      row.company_name ?? '',
      row.salutation ?? '',
      formatInZone(row.created_at, timezone),
      SOURCE_LABELS.get(row.source) ?? row.source,
    ]
      .map(csvCell)
      .join(','),
  )

  return `${BYTE_ORDER_MARK}${[header, ...lines].join('\r\n')}\r\n`
}

/** The unique index on (user_id, lower(email)) refused the write. */
function isDuplicate(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505'
}

/** Recomputes a campaign's counter from its rows, as the contact repository does. */
async function syncTotals(client: Pool | PoolClient, campaignIds: readonly string[]) {
  if (campaignIds.length === 0) {
    return
  }

  await client.query(
    `UPDATE campaigns c
     SET total_contacts = (SELECT count(*) FROM contacts WHERE campaign_id = c.id)
     WHERE c.id = ANY($1::uuid[])`,
    [campaignIds],
  )
}

export function createAddressBookRepository(pool: Pool): AddressBookRepository {
  async function list(userId: string, query: AddressBookQuery) {
    const filters = ['user_id = $1']
    const values: unknown[] = [userId]

    const bind = (value: unknown) => {
      values.push(value)
      return `$${String(values.length)}`
    }

    if (query.source) {
      filters.push(`source = ${bind(query.source)}`)
    }

    if (query.excludeCampaignId) {
      filters.push(
        `NOT EXISTS (SELECT 1 FROM contacts x
                     WHERE x.campaign_id = ${bind(query.excludeCampaignId)}
                       AND lower(x.email) = lower(address_book.email))`,
      )
    }

    if (query.search) {
      // LIKE's own wildcards are escaped: a search for "50%" means the text.
      const pattern = bind(`%${query.search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`)
      filters.push(
        `(lower(email) LIKE ${pattern}
          OR lower(coalesce(contact_name, '')) LIKE ${pattern}
          OR lower(coalesce(company_name, '')) LIKE ${pattern})`,
      )
    }

    const where = filters.join(' AND ')

    const [counted, page] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM address_book WHERE ${where}`,
        values,
      ),
      pool.query<AddressBookRow>(
        `SELECT ${COLUMNS} FROM address_book WHERE ${where}
         ORDER BY ${orderBy(query.sort, query.order)}
         LIMIT $${String(values.length + 1)} OFFSET $${String(values.length + 2)}`,
        [...values, query.limit, query.offset],
      ),
    ])

    return { contacts: page.rows, total: Number(counted.rows[0]?.total ?? 0) }
  }

  return {
    list,

    async all(userId, query) {
      const { contacts } = await list(userId, {
        ...query,
        limit: EXPORT_LIMIT,
        offset: 0,
      })
      return contacts
    },

    async add(userId, details) {
      try {
        const { rows } = await pool.query<AddressBookRow>(
          `INSERT INTO address_book (user_id, email, contact_name, company_name, salutation, source)
           VALUES ($1, $2, $3, $4, $5, 'manual')
           RETURNING ${COLUMNS}`,
          [
            userId,
            details.email,
            details.contact_name,
            details.company_name,
            details.salutation,
          ],
        )

        const contact = rows[0]
        return contact ? { kind: 'saved', contact } : { kind: 'not_found' }
      } catch (err) {
        if (isDuplicate(err)) {
          return { kind: 'duplicate' }
        }
        throw err
      }
    },

    async update(userId, id, details) {
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const { rows } = await client.query<AddressBookRow>(
          `UPDATE address_book
           SET email = $3, contact_name = $4, company_name = $5, salutation = $6,
               updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING ${COLUMNS}`,
          [
            id,
            userId,
            details.email,
            details.contact_name,
            details.company_name,
            details.salutation,
          ],
        )

        const contact = rows[0]

        if (!contact) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }

        // The campaigns to come take the new details: every recipient of this
        // person not sent to yet. One already sent to, or failed, keeps what
        // went out. A campaign that already holds the new address under
        // another recipient is left alone rather than given a duplicate.
        await client.query(
          `UPDATE contacts ct
           SET email = $2, contact_name = $3, company_name = $4, salutation = $5
           WHERE ct.book_id = $1
             AND ct.status IN ('pending', 'ignored')
             AND NOT EXISTS (
               SELECT 1 FROM contacts other
               WHERE other.campaign_id = ct.campaign_id
                 AND other.id <> ct.id
                 AND lower(other.email) = lower($2)
             )`,
          [
            id,
            details.email,
            details.contact_name,
            details.company_name,
            details.salutation,
          ],
        )

        await client.query('COMMIT')
        return { kind: 'saved', contact }
      } catch (err) {
        await client.query('ROLLBACK')
        if (isDuplicate(err)) {
          return { kind: 'duplicate' }
        }
        throw err
      } finally {
        client.release()
      }
    },

    async remove(userId, id) {
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const owned = await client.query(
          'SELECT 1 FROM address_book WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [id, userId],
        )

        if (owned.rowCount === 0) {
          await client.query('ROLLBACK')
          return false
        }

        // Out of every send still to come. A recipient with anything in the
        // log stays: deleting it would delete its history with it.
        const { rows } = await client.query<{ campaign_id: string }>(
          `DELETE FROM contacts ct
           WHERE ct.book_id = $1
             AND ct.status IN ('pending', 'ignored')
             AND NOT EXISTS (SELECT 1 FROM logs l WHERE l.contact_id = ct.id)
           RETURNING ct.campaign_id`,
          [id],
        )

        await client.query('DELETE FROM address_book WHERE id = $1', [id])
        await syncTotals(client, [...new Set(rows.map((row) => row.campaign_id))])
        await client.query('COMMIT')
        return true
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    async copyToCampaign(userId, campaignId, ids) {
      const { rows: owned } = await pool.query<{ status: CampaignStatus }>(
        'SELECT status FROM campaigns WHERE id = $1 AND user_id = $2',
        [campaignId, userId],
      )
      const campaign = owned[0]

      if (!campaign) {
        return { kind: 'not_found' }
      }

      // Owner checked in the SELECT: an id of another account's entry copies
      // nothing. The draft check sits in the same statement, so a launch
      // landing between the read above and this line wins; an address the
      // campaign already holds is skipped by its unique index.
      const result = await pool.query(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation, source, book_id)
         SELECT $1::uuid, ab.email, ab.contact_name, ab.company_name, ab.salutation, ab.source, ab.id
         FROM address_book ab
         WHERE ab.id = ANY($2::uuid[]) AND ab.user_id = $3
           AND EXISTS (SELECT 1 FROM campaigns t
                       WHERE t.id = $1 AND t.user_id = $3 AND t.status = 'draft')
         ON CONFLICT DO NOTHING`,
        [campaignId, ids, userId],
      )

      if (campaign.status !== 'draft') {
        return { kind: 'not_editable' }
      }

      await syncTotals(pool, [campaignId])
      return { kind: 'copied', imported: result.rowCount ?? 0 }
    },
  }
}
