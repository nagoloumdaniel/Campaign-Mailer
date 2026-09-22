import type { Pool } from 'pg'

import type { ImportedContact } from './contactImport.js'

export type ContactStatus = 'pending' | 'sent' | 'failed' | 'ignored'

export interface ContactRow {
  id: string
  campaign_id: string
  email: string
  company_name: string | null
  contact_name: string | null
  salutation: string | null
  status: ContactStatus
  error_message: string | null
  attempts: number
  created_at: Date
  sent_at: Date | null
  opened_at: Date | null
  clicked_at: Date | null
}

const COLUMNS = `
  id, campaign_id, email, company_name, contact_name, salutation,
  status, error_message, attempts, created_at, sent_at, opened_at, clicked_at
`

export interface ListContactsOptions {
  status?: ContactStatus | undefined
  /** Matches an address, a name or a company. */
  search?: string | undefined
  limit: number
  offset: number
}

export interface ContactRepository {
  existingEmails(campaignId: string): Promise<Set<string>>
  insertMany(campaignId: string, contacts: ImportedContact[]): Promise<number>
  list(
    campaignId: string,
    options: ListContactsOptions,
  ): Promise<{ contacts: ContactRow[]; total: number }>
  add(
    campaignId: string,
    contact: Omit<ImportedContact, 'line'>,
  ): Promise<ContactRow | null>
  update(
    campaignId: string,
    contactId: string,
    patch: { status?: ContactStatus | undefined },
  ): Promise<ContactRow | null>
  remove(campaignId: string, contactId: string): Promise<boolean>
}

/** How many rows go into one INSERT. Keeps the statement well under any parameter cap. */
const CHUNK = 500

export function createContactRepository(pool: Pool): ContactRepository {
  /**
   * Recomputes the campaign's counter from the rows themselves.
   *
   * An increment would drift the first time an insert half-fails or a delete
   * races another, and a wrong total shows up in the send plan rather than in
   * an error. Counting is cheap next to the write that preceded it.
   */
  async function syncTotal(client: Pool | import('pg').PoolClient, campaignId: string) {
    await client.query(
      `UPDATE campaigns
       SET total_contacts = (SELECT count(*) FROM contacts WHERE campaign_id = $1)
       WHERE id = $1`,
      [campaignId],
    )
  }

  return {
    async existingEmails(campaignId) {
      const { rows } = await pool.query<{ email: string }>(
        'SELECT lower(email) AS email FROM contacts WHERE campaign_id = $1',
        [campaignId],
      )

      return new Set(rows.map((row) => row.email))
    },

    async insertMany(campaignId, contacts) {
      if (contacts.length === 0) {
        return 0
      }

      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        let inserted = 0

        for (let start = 0; start < contacts.length; start += CHUNK) {
          const slice = contacts.slice(start, start + CHUNK)
          const values: unknown[] = []
          const tuples = slice.map((contact, index) => {
            const base = index * 5
            values.push(
              campaignId,
              contact.email,
              contact.contact_name,
              contact.company_name,
              contact.salutation,
            )
            return `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)}, $${String(base + 5)})`
          })

          // ON CONFLICT DO NOTHING rather than a failure: the unique index on
          // (campaign_id, lower(email)) is the last word on duplicates, and a
          // row that slipped past the in-memory check because of a concurrent
          // import should be skipped, not abort the whole file.
          const result = await client.query(
            `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation)
             VALUES ${tuples.join(', ')}
             ON CONFLICT DO NOTHING`,
            values,
          )

          inserted += result.rowCount ?? 0
        }

        await syncTotal(client, campaignId)
        await client.query('COMMIT')

        return inserted
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    async list(campaignId, options) {
      const filters = ['campaign_id = $1']
      const values: unknown[] = [campaignId]

      if (options.status) {
        values.push(options.status)
        filters.push(`status = $${String(values.length)}`)
      }

      if (options.search) {
        values.push(`%${options.search.toLowerCase()}%`)
        const placeholder = `$${String(values.length)}`
        filters.push(
          `(lower(email) LIKE ${placeholder}
            OR lower(coalesce(contact_name, '')) LIKE ${placeholder}
            OR lower(coalesce(company_name, '')) LIKE ${placeholder})`,
        )
      }

      const where = filters.join(' AND ')

      const { rows: counted } = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM contacts WHERE ${where}`,
        values,
      )

      const { rows } = await pool.query<ContactRow>(
        `SELECT ${COLUMNS} FROM contacts WHERE ${where}
         ORDER BY created_at, email
         LIMIT $${String(values.length + 1)} OFFSET $${String(values.length + 2)}`,
        [...values, options.limit, options.offset],
      )

      return { contacts: rows, total: Number(counted[0]?.total ?? 0) }
    },

    async add(campaignId, contact) {
      const { rows } = await pool.query<ContactRow>(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation, source)
         VALUES ($1, $2, $3, $4, $5, 'manual')
         ON CONFLICT DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          campaignId,
          contact.email,
          contact.contact_name,
          contact.company_name,
          contact.salutation,
        ],
      )

      const row = rows[0]

      if (row) {
        await syncTotal(pool, campaignId)
      }

      return row ?? null
    },

    async update(campaignId, contactId, patch) {
      if (!patch.status) {
        return null
      }

      const { rows } = await pool.query<ContactRow>(
        `UPDATE contacts SET status = $3
         WHERE id = $2 AND campaign_id = $1
         RETURNING ${COLUMNS}`,
        [campaignId, contactId, patch.status],
      )

      return rows[0] ?? null
    },

    async remove(campaignId, contactId) {
      const result = await pool.query(
        'DELETE FROM contacts WHERE id = $1 AND campaign_id = $2',
        [contactId, campaignId],
      )

      const removed = (result.rowCount ?? 0) > 0

      if (removed) {
        await syncTotal(pool, campaignId)
      }

      return removed
    },
  }
}
