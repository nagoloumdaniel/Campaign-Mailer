import type { Pool } from 'pg'

import type { CampaignType } from '../schemas/campaign.js'

import type { CampaignStatus } from './campaignState.js'
import type { ContactStatus } from './contacts.js'
import { campaignTypeLabel, formatInZone } from './history.js'
import { csvCell } from './logExport.js'

/**
 * Every contact of an account, across its campaigns: the address book.
 *
 * Contacts belong to a campaign, and that stays true here. The address book is
 * a view over all of them with the campaign attached, not a second store of
 * people: a contact typed here goes into a campaign like any other, and one
 * removed here is removed from its campaign.
 *
 * Writing follows the campaign's rules rather than inventing its own. A contact
 * is added or edited only while its campaign is a draft, because once a
 * campaign is launched its list is what the send engine plans from, and an
 * address edited under a queued job would send to someone the user never
 * launched to. Removing is always allowed: a person asking to be forgotten is
 * forgotten whatever the campaign's state, and the send log keeps its line with
 * the contact detached, as account deletion already does.
 *
 * Every query joins the campaign and filters on its owner in the SQL itself, so
 * another account's contact is not found rather than forbidden.
 */

export type ContactSource = 'csv' | 'manual' | 'mailfind'

export const ADDRESS_BOOK_SORTS = [
  'company',
  'name',
  'email',
  'campaign',
  'status',
  'created',
] as const

export type AddressBookSort = (typeof ADDRESS_BOOK_SORTS)[number]

export interface AddressBookRow {
  id: string
  campaign_id: string
  campaign_name: string
  campaign_status: CampaignStatus
  campaign_type: CampaignType
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
  status: ContactStatus
  source: ContactSource
  error_message: string | null
  created_at: Date
  sent_at: Date | null
}

export interface AddressBookQuery {
  /** Matches an address, a name, a company or a campaign. */
  search?: string | undefined
  status?: ContactStatus | undefined
  source?: ContactSource | undefined
  campaignId?: string | undefined
  /** One row per address, its most recent contact, rather than one per campaign. */
  unique?: boolean | undefined
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
  /** The campaign has been launched: its list is the send engine's now. */
  | { kind: 'not_editable' }
  | { kind: 'duplicate' }

export interface AddressBookRepository {
  list(
    userId: string,
    query: AddressBookQuery,
  ): Promise<{ contacts: AddressBookRow[]; total: number }>
  /** Every contact the filters match, in their order, for the export. */
  all(
    userId: string,
    query: Omit<AddressBookQuery, 'limit' | 'offset'>,
  ): Promise<AddressBookRow[]>
  add(userId: string, campaignId: string, details: ContactDetails): Promise<WriteOutcome>
  update(
    userId: string,
    contactId: string,
    details: ContactDetails,
  ): Promise<WriteOutcome>
  remove(userId: string, contactId: string): Promise<boolean>
  /** Copies contacts of the account into one of its drafts. */
  copyToCampaign(
    userId: string,
    campaignId: string,
    contactIds: readonly string[],
  ): Promise<CopyOutcome>
}

export type CopyOutcome =
  { kind: 'copied'; imported: number } | { kind: 'not_found' } | { kind: 'not_editable' }

const SELECT = `
  SELECT ct.id, ct.campaign_id, c.name AS campaign_name, c.status AS campaign_status,
         c.type AS campaign_type, ct.email, ct.contact_name, ct.company_name,
         ct.salutation, ct.status, ct.source, ct.error_message, ct.created_at, ct.sent_at
  FROM contacts ct
  JOIN campaigns c ON c.id = ct.campaign_id
`

/**
 * The ORDER BY for each sort, chosen from a fixed map: the column name never
 * comes from the request. Text is compared case-insensitively, an empty company
 * or name goes last whichever the direction, and the id breaks every tie so a
 * page boundary never shows a row twice or skips one.
 */
function orderBy(sort: AddressBookSort, order: 'asc' | 'desc'): string {
  const dir = order === 'desc' ? 'DESC' : 'ASC'

  const keys = new Map<AddressBookSort, string>([
    [
      'company',
      `lower(ct.company_name) ${dir} NULLS LAST, lower(ct.contact_name) ASC NULLS LAST, lower(ct.email) ASC`,
    ],
    ['name', `lower(ct.contact_name) ${dir} NULLS LAST, lower(ct.email) ASC`],
    ['email', `lower(ct.email) ${dir}`],
    ['campaign', `lower(c.name) ${dir}, lower(ct.email) ASC`],
    ['status', `ct.status ${dir}, lower(ct.email) ASC`],
    ['created', `ct.created_at ${dir}`],
  ])

  return `${keys.get(sort) ?? `lower(ct.email) ${dir}`}, ct.id ${dir}`
}

/**
 * The most rows one export carries: the same bound as the history's. An
 * account past it filters before exporting, which it would want to anyway.
 */
const EXPORT_LIMIT = 50_000

/** Written by code point: the character itself is invisible in source and fails the linter. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

const CONTACT_STATUS_LABELS = new Map<ContactStatus, string>([
  ['pending', 'en attente'],
  ['sent', 'envoyé'],
  ['failed', 'en erreur'],
  ['ignored', 'ignoré'],
])

const SOURCE_LABELS = new Map<ContactSource, string>([
  ['csv', 'import CSV'],
  ['manual', 'ajout manuel'],
  ['mailfind', 'MailFind'],
])

const CAMPAIGN_STATUS_LABELS = new Map<CampaignStatus, string>([
  ['draft', 'brouillon'],
  ['scheduled', 'programmée'],
  ['running', 'en cours'],
  ['paused', 'en pause'],
  ['completed', 'terminée'],
])

/**
 * The address book as a CSV: every characteristic of each contact, and of its
 * campaign.
 *
 * Every cell goes through `csvCell`, which neutralises the leading `=` a
 * spreadsheet would run as a formula: the addresses came from files the user
 * was handed. A BOM so Excel reads the accents; CRLF as RFC 4180 specifies.
 */
export function addressBookToCsv(
  rows: readonly AddressBookRow[],
  timezone: string,
): string {
  const header = [
    'adresse',
    'contact',
    'entreprise',
    'civilite',
    'statut',
    'origine',
    'campagne',
    'type_campagne',
    'statut_campagne',
    'ajoute_le',
    'envoye_le',
    'erreur',
  ]
    .map(csvCell)
    .join(',')

  const lines = rows.map((row) =>
    [
      row.email,
      row.contact_name ?? '',
      row.company_name ?? '',
      row.salutation ?? '',
      CONTACT_STATUS_LABELS.get(row.status) ?? row.status,
      SOURCE_LABELS.get(row.source) ?? row.source,
      row.campaign_name,
      campaignTypeLabel(row.campaign_type),
      CAMPAIGN_STATUS_LABELS.get(row.campaign_status) ?? row.campaign_status,
      formatInZone(row.created_at, timezone),
      row.sent_at ? formatInZone(row.sent_at, timezone) : '',
      row.error_message ?? '',
    ]
      .map(csvCell)
      .join(','),
  )

  return `${BYTE_ORDER_MARK}${[header, ...lines].join('\r\n')}\r\n`
}

/** The unique index on (campaign_id, lower(email)) refused the write. */
function isDuplicate(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505'
}

export function createAddressBookRepository(pool: Pool): AddressBookRepository {
  async function findOwned(userId: string, contactId: string) {
    const { rows } = await pool.query<AddressBookRow>(
      `${SELECT} WHERE ct.id = $1 AND c.user_id = $2`,
      [contactId, userId],
    )
    return rows[0] ?? null
  }

  async function syncTotal(campaignId: string) {
    await pool.query(
      `UPDATE campaigns
       SET total_contacts = (SELECT count(*) FROM contacts WHERE campaign_id = $1)
       WHERE id = $1`,
      [campaignId],
    )
  }

  return {
    async list(userId, query) {
      const filters = ['c.user_id = $1']
      const values: unknown[] = [userId]

      const bind = (value: unknown) => {
        values.push(value)
        return `$${String(values.length)}`
      }

      if (query.status) {
        filters.push(`ct.status = ${bind(query.status)}`)
      }

      if (query.source) {
        filters.push(`ct.source = ${bind(query.source)}`)
      }

      if (query.campaignId) {
        filters.push(`ct.campaign_id = ${bind(query.campaignId)}`)
      }

      if (query.unique) {
        // The most recent contact of each address, among the account's own:
        // the same person in three campaigns is one person to pick.
        filters.push(
          `ct.id = (SELECT ct2.id FROM contacts ct2
                    JOIN campaigns c2 ON c2.id = ct2.campaign_id
                    WHERE c2.user_id = $1 AND lower(ct2.email) = lower(ct.email)
                    ORDER BY ct2.created_at DESC, ct2.id DESC LIMIT 1)`,
        )
      }

      if (query.excludeCampaignId) {
        filters.push(
          `NOT EXISTS (SELECT 1 FROM contacts x
                       WHERE x.campaign_id = ${bind(query.excludeCampaignId)}
                         AND lower(x.email) = lower(ct.email))`,
        )
      }

      if (query.search) {
        // LIKE's own wildcards are escaped: a search for "50%" means the text.
        const pattern = bind(`%${query.search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`)
        filters.push(
          `(lower(ct.email) LIKE ${pattern}
            OR lower(coalesce(ct.contact_name, '')) LIKE ${pattern}
            OR lower(coalesce(ct.company_name, '')) LIKE ${pattern}
            OR lower(c.name) LIKE ${pattern})`,
        )
      }

      const where = filters.join(' AND ')

      const [counted, page] = await Promise.all([
        pool.query<{ total: string }>(
          `SELECT count(*)::text AS total
           FROM contacts ct JOIN campaigns c ON c.id = ct.campaign_id
           WHERE ${where}`,
          values,
        ),
        pool.query<AddressBookRow>(
          `${SELECT} WHERE ${where}
           ORDER BY ${orderBy(query.sort, query.order)}
           LIMIT $${String(values.length + 1)} OFFSET $${String(values.length + 2)}`,
          [...values, query.limit, query.offset],
        ),
      ])

      return { contacts: page.rows, total: Number(counted.rows[0]?.total ?? 0) }
    },

    async all(userId, query) {
      const { contacts } = await this.list(userId, {
        ...query,
        limit: EXPORT_LIMIT,
        offset: 0,
      })
      return contacts
    },

    async add(userId, campaignId, details) {
      const { rows: owned } = await pool.query<{ status: CampaignStatus }>(
        'SELECT status FROM campaigns WHERE id = $1 AND user_id = $2',
        [campaignId, userId],
      )
      const campaign = owned[0]

      if (!campaign) {
        return { kind: 'not_found' }
      }

      try {
        // The draft check is in the INSERT itself, so a launch landing between
        // the read above and this line wins.
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation, source)
           SELECT c.id, $3, $4, $5, $6, 'manual'
           FROM campaigns c WHERE c.id = $1 AND c.user_id = $2 AND c.status = 'draft'
           RETURNING id`,
          [
            campaignId,
            userId,
            details.email,
            details.contact_name,
            details.company_name,
            details.salutation,
          ],
        )

        const id = rows[0]?.id
        if (!id) {
          return { kind: 'not_editable' }
        }

        await syncTotal(campaignId)
        const contact = await findOwned(userId, id)
        return contact ? { kind: 'saved', contact } : { kind: 'not_found' }
      } catch (err) {
        if (isDuplicate(err)) {
          return { kind: 'duplicate' }
        }
        throw err
      }
    },

    async update(userId, contactId, details) {
      try {
        const { rows } = await pool.query<{ id: string }>(
          `UPDATE contacts ct
           SET email = $3, contact_name = $4, company_name = $5, salutation = $6
           FROM campaigns c
           WHERE ct.id = $1 AND c.id = ct.campaign_id AND c.user_id = $2
             AND c.status = 'draft'
           RETURNING ct.id`,
          [
            contactId,
            userId,
            details.email,
            details.contact_name,
            details.company_name,
            details.salutation,
          ],
        )

        const contact = await findOwned(userId, contactId)

        if (!contact) {
          return { kind: 'not_found' }
        }

        return rows[0] ? { kind: 'saved', contact } : { kind: 'not_editable' }
      } catch (err) {
        if (isDuplicate(err)) {
          return { kind: 'duplicate' }
        }
        throw err
      }
    },

    async remove(userId, contactId) {
      const { rows } = await pool.query<{ campaign_id: string }>(
        `DELETE FROM contacts ct
         USING campaigns c
         WHERE ct.id = $1 AND c.id = ct.campaign_id AND c.user_id = $2
         RETURNING ct.campaign_id`,
        [contactId, userId],
      )

      const campaignId = rows[0]?.campaign_id
      if (!campaignId) {
        return false
      }

      await syncTotal(campaignId)
      return true
    },

    async copyToCampaign(userId, campaignId, contactIds) {
      const { rows: owned } = await pool.query<{ status: CampaignStatus }>(
        'SELECT status FROM campaigns WHERE id = $1 AND user_id = $2',
        [campaignId, userId],
      )
      const campaign = owned[0]

      if (!campaign) {
        return { kind: 'not_found' }
      }

      // The owner is checked in the SELECT: an id of another account's contact
      // copies nothing. The draft check sits in the same statement, so a launch
      // landing between the read above and this line wins. The same address
      // picked twice is copied once, its most recent version; one the campaign
      // already holds is skipped by the unique index.
      const result = await pool.query(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation, source)
         SELECT DISTINCT ON (lower(ct.email))
                $1::uuid, ct.email, ct.contact_name, ct.company_name, ct.salutation, ct.source
         FROM contacts ct
         JOIN campaigns src ON src.id = ct.campaign_id
         WHERE ct.id = ANY($2::uuid[]) AND src.user_id = $3
           AND EXISTS (SELECT 1 FROM campaigns t
                       WHERE t.id = $1 AND t.user_id = $3 AND t.status = 'draft')
         ORDER BY lower(ct.email), ct.created_at DESC
         ON CONFLICT DO NOTHING`,
        [campaignId, contactIds, userId],
      )

      if (campaign.status !== 'draft') {
        return { kind: 'not_editable' }
      }

      await syncTotal(campaignId)
      return { kind: 'copied', imported: result.rowCount ?? 0 }
    },
  }
}
