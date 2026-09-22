import type { Pool } from 'pg'

import type { CampaignType } from '../schemas/campaign.js'
import { csvCell } from './logExport.js'
import { renderText } from './template.js'

/**
 * Every message this account has sent, across every campaign.
 *
 * Read from `logs` rather than from `contacts.sent_at`, for one reason that
 * matters: the log is the record of what actually left, and the unique index
 * `logs_one_sent_per_contact_idx` guarantees one row per delivery. Counting
 * contacts would double a follow-up campaign's recipients against the original
 * run, which is precisely the comparison this page exists to make.
 *
 * A failed attempt is included too, as its own outcome: "who did I write to"
 * and "who did I fail to reach" are the same question asked twice, and a page
 * that hides the second half sends the user to look for a bounce that is not
 * there.
 */

export type HistoryOutcome = 'sent' | 'failed'

export interface HistoryRow {
  id: string
  campaign_id: string
  campaign_name: string
  campaign_type: CampaignType
  campaign_subject: string | null
  contact_id: string | null
  email: string | null
  contact_name: string | null
  company_name: string | null
  salutation: string | null
  outcome: HistoryOutcome
  message: string | null
  created_at: Date
}

export interface HistoryQuery {
  /** Matches an address, a contact name, a company or a campaign name. */
  search?: string | undefined
  type?: CampaignType | undefined
  campaignId?: string | undefined
  outcome?: HistoryOutcome | undefined
  limit: number
  offset: number
}

export interface HistoryPage {
  rows: HistoryRow[]
  total: number
  /** How many messages per campaign type, over the whole history, filters applied. */
  byType: Record<CampaignType, number>
}

export interface HistoryRepository {
  list(userId: string, query: HistoryQuery): Promise<HistoryPage>
  /** The same rows without paging, for the CSV export. */
  all(
    userId: string,
    query: Omit<HistoryQuery, 'limit' | 'offset'>,
  ): Promise<HistoryRow[]>
}

/**
 * An error row without a contact is a pause reason — an expired Google
 * authorization, say — not a message that failed to reach someone. It has no
 * recipient, so it has no place in a list of recipients.
 */
const BASE_WHERE = `
  c.user_id = $1
  AND (l.event_type = 'sent' OR (l.event_type = 'error' AND l.contact_id IS NOT NULL))
`

const SELECT_ROWS = `
  SELECT l.id,
         l.campaign_id,
         c.name        AS campaign_name,
         c.type        AS campaign_type,
         c.subject     AS campaign_subject,
         l.contact_id,
         ct.email,
         ct.contact_name,
         ct.company_name,
         ct.salutation,
         CASE WHEN l.event_type = 'sent' THEN 'sent' ELSE 'failed' END AS outcome,
         l.message,
         l.created_at
  FROM logs l
  JOIN campaigns c ON c.id = l.campaign_id
  LEFT JOIN contacts ct ON ct.id = l.contact_id
`

/** Builds the WHERE clause and its bound values. No value is ever interpolated. */
function filters(
  userId: string,
  query: Omit<HistoryQuery, 'limit' | 'offset'>,
): { where: string; values: unknown[] } {
  const clauses = [BASE_WHERE]
  const values: unknown[] = [userId]

  if (query.type) {
    values.push(query.type)
    clauses.push(`c.type = $${String(values.length)}::campaign_type`)
  }

  if (query.campaignId) {
    values.push(query.campaignId)
    clauses.push(`l.campaign_id = $${String(values.length)}`)
  }

  if (query.outcome) {
    clauses.push(
      query.outcome === 'sent' ? `l.event_type = 'sent'` : `l.event_type = 'error'`,
    )
  }

  if (query.search) {
    values.push(`%${query.search.toLowerCase()}%`)
    const placeholder = `$${String(values.length)}`
    clauses.push(
      `(lower(coalesce(ct.email, '')) LIKE ${placeholder}
        OR lower(coalesce(ct.contact_name, '')) LIKE ${placeholder}
        OR lower(coalesce(ct.company_name, '')) LIKE ${placeholder}
        OR lower(c.name) LIKE ${placeholder})`,
    )
  }

  return { where: clauses.join(' AND '), values }
}

const EMPTY_BY_TYPE: Record<CampaignType, number> = {
  prospection: 0,
  relance: 0,
  marketing: 0,
  alternance: 0,
  autre: 0,
}

export function createHistoryRepository(pool: Pool): HistoryRepository {
  return {
    async list(userId, query) {
      const { where, values } = filters(userId, query)

      const [counted, page, grouped] = await Promise.all([
        pool.query<{ total: string }>(
          `SELECT count(*)::text AS total
           FROM logs l
           JOIN campaigns c ON c.id = l.campaign_id
           LEFT JOIN contacts ct ON ct.id = l.contact_id
           WHERE ${where}`,
          values,
        ),
        pool.query<HistoryRow>(
          `${SELECT_ROWS} WHERE ${where}
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT $${String(values.length + 1)} OFFSET $${String(values.length + 2)}`,
          [...values, query.limit, query.offset],
        ),
        // The tallies the page groups by, computed over the same filters minus
        // the type itself: a user filtering on "relance" still needs to see
        // that the other tabs hold something.
        pool.query<{ campaign_type: CampaignType; n: number }>(
          `SELECT c.type AS campaign_type, count(*)::int AS n
           FROM logs l
           JOIN campaigns c ON c.id = l.campaign_id
           LEFT JOIN contacts ct ON ct.id = l.contact_id
           WHERE ${filters(userId, { ...query, type: undefined }).where}
           GROUP BY 1`,
          filters(userId, { ...query, type: undefined }).values,
        ),
      ])

      const byType = { ...EMPTY_BY_TYPE }

      for (const row of grouped.rows) {
        // A switch rather than indexing by a value read from the database.
        switch (row.campaign_type) {
          case 'prospection':
            byType.prospection = row.n
            break
          case 'relance':
            byType.relance = row.n
            break
          case 'marketing':
            byType.marketing = row.n
            break
          case 'alternance':
            byType.alternance = row.n
            break
          case 'autre':
            byType.autre = row.n
            break
          default:
            break
        }
      }

      return {
        rows: page.rows,
        total: Number(counted.rows[0]?.total ?? 0),
        byType,
      }
    },

    async all(userId, query) {
      const { where, values } = filters(userId, query)

      const { rows } = await pool.query<HistoryRow>(
        `${SELECT_ROWS} WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT 50000`,
        values,
      )

      return rows
    },
  }
}

/**
 * The subject this recipient actually received.
 *
 * The campaign stores the template — `Candidature — {{company_name}}` — and a
 * history that shows the template reads as if the braces had gone out. The
 * merge is the same one the composer runs, over the contact the log points
 * at, so the line on screen is the line in the recipient's inbox. A contact
 * deleted since has no values left, and the template's own fallbacks apply.
 */
export function subjectOf(row: HistoryRow): string | null {
  if (row.campaign_subject === null) {
    return null
  }

  return renderText(row.campaign_subject, {
    email: row.email,
    contact_name: row.contact_name,
    company_name: row.company_name,
    salutation: row.salutation,
  })
}

const TYPE_LABELS: Record<CampaignType, string> = {
  prospection: 'Prospection',
  relance: 'Relance',
  marketing: 'Marketing',
  alternance: 'Alternance / stage',
  autre: 'Autre',
}

export function campaignTypeLabel(type: CampaignType): string {
  // A Map lookup, not a property read on a value that came from the database.
  return new Map(Object.entries(TYPE_LABELS)).get(type) ?? type
}

/** `YYYY-MM-DD HH:mm:ss` in the reader's own zone; the sv-SE locale writes that shape. */
export function formatInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/**
 * The history as a CSV.
 *
 * Every cell goes through `csvCell`, which neutralises the leading `=` a
 * spreadsheet would run as a formula. The addresses came from a file the user
 * was handed, so any of them may carry one.
 */
export function historyToCsv(rows: readonly HistoryRow[], timezone: string): string {
  const header = [
    'date',
    'adresse',
    'contact',
    'entreprise',
    'campagne',
    'type',
    'objet',
    'resultat',
    'detail',
  ]
    .map(csvCell)
    .join(',')

  const lines = rows.map((row) =>
    [
      formatInZone(row.created_at, timezone),
      row.email ?? '',
      row.contact_name ?? '',
      row.company_name ?? '',
      row.campaign_name,
      campaignTypeLabel(row.campaign_type),
      subjectOf(row) ?? '',
      row.outcome === 'sent' ? 'envoyé' : 'erreur',
      row.message ?? '',
    ]
      .map(csvCell)
      .join(','),
  )

  // A BOM, so Excel reads the accents as UTF-8; CRLF, as RFC 4180 specifies.
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}
