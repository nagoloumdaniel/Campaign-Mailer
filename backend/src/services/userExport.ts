import type { Pool } from 'pg'

import { csvCell } from './logExport.js'

/**
 * Everything the application holds about a user, in a form they can keep.
 *
 * The right of access covers all personal data, so the export is complete:
 * the account, every campaign with its message, every contact and every log
 * line. It deliberately leaves out the Google tokens. They are stored
 * encrypted, they are credentials rather than information about the person,
 * and a file the user downloads, forwards and forgets in a folder is exactly
 * where a credential must not end up.
 */

export interface UserExport {
  exportedAt: string
  account: {
    email: string
    googleAccountId: string
    createdAt: string
  }
  campaigns: ExportedCampaign[]
  /** The address book: one entry per address, as the Contacts page shows it. */
  addressBook: {
    email: string
    contactName: string | null
    companyName: string | null
    salutation: string | null
    source: string
    createdAt: string
  }[]
}

export interface ExportedCampaign {
  id: string
  name: string
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  type: string
  /** Every file joined to the campaign's messages, in upload order. */
  attachmentNames: string[]
  status: string
  mailsPerDay: number
  startHour: number
  pauseMs: number
  timezone: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  contacts: ExportedContact[]
  logs: ExportedLog[]
}

export interface ExportedContact {
  email: string
  contactName: string | null
  companyName: string | null
  salutation: string | null
  status: string
  errorMessage: string | null
  attempts: number
  sentAt: string | null
}

export interface ExportedLog {
  createdAt: string
  event: string
  contactEmail: string | null
  message: string | null
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

export async function buildUserExport(
  pool: Pool,
  userId: string,
): Promise<UserExport | null> {
  const account = await pool.query<{
    email: string
    google_id: string
    created_at: Date
  }>('SELECT email, google_id, created_at FROM users WHERE id = $1', [userId])
  const user = account.rows[0]

  if (!user) {
    return null
  }

  const campaigns = await pool.query<{
    id: string
    name: string
    subject: string | null
    body_html: string | null
    body_text: string | null
    type: string
    attachment_names: string[] | null
    status: string
    mails_per_day: number
    start_hour: number
    pause_ms: number
    timezone: string
    created_at: Date
    started_at: Date | null
    completed_at: Date | null
  }>(
    `SELECT c.id, c.name, c.subject, c.body_html, c.body_text, c.type, c.status,
            c.mails_per_day, c.start_hour, c.pause_ms, c.timezone,
            c.created_at, c.started_at, c.completed_at,
            (SELECT array_agg(a.name ORDER BY a.created_at, a.id)
             FROM campaign_attachments a WHERE a.campaign_id = c.id) AS attachment_names
     FROM campaigns c WHERE c.user_id = $1 ORDER BY c.created_at`,
    [userId],
  )

  // Two queries for all contacts and all logs of the user, rather than two per
  // campaign: an account with fifty campaigns should not cost a hundred trips.
  const contacts = await pool.query<{
    campaign_id: string
    email: string
    contact_name: string | null
    company_name: string | null
    salutation: string | null
    status: string
    error_message: string | null
    attempts: number
    sent_at: Date | null
  }>(
    `SELECT ct.campaign_id, ct.email, ct.contact_name, ct.company_name, ct.salutation,
            ct.status, ct.error_message, ct.attempts, ct.sent_at
     FROM contacts ct JOIN campaigns c ON c.id = ct.campaign_id
     WHERE c.user_id = $1
     ORDER BY ct.created_at, ct.email`,
    [userId],
  )

  const logs = await pool.query<{
    campaign_id: string
    created_at: Date
    event_type: string
    email: string | null
    message: string | null
  }>(
    `SELECT l.campaign_id, l.created_at, l.event_type, ct.email, l.message
     FROM logs l
     JOIN campaigns c ON c.id = l.campaign_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE c.user_id = $1
     ORDER BY l.created_at, l.id`,
    [userId],
  )

  const contactsByCampaign = new Map<string, ExportedContact[]>()
  for (const row of contacts.rows) {
    const list = contactsByCampaign.get(row.campaign_id) ?? []
    list.push({
      email: row.email,
      contactName: row.contact_name,
      companyName: row.company_name,
      salutation: row.salutation,
      status: row.status,
      errorMessage: row.error_message,
      attempts: row.attempts,
      sentAt: iso(row.sent_at),
    })
    contactsByCampaign.set(row.campaign_id, list)
  }

  const logsByCampaign = new Map<string, ExportedLog[]>()
  for (const row of logs.rows) {
    const list = logsByCampaign.get(row.campaign_id) ?? []
    list.push({
      createdAt: row.created_at.toISOString(),
      event: row.event_type,
      contactEmail: row.email,
      message: row.message,
    })
    logsByCampaign.set(row.campaign_id, list)
  }

  const book = await pool.query<{
    email: string
    contact_name: string | null
    company_name: string | null
    salutation: string | null
    source: string
    created_at: Date
  }>(
    `SELECT email, contact_name, company_name, salutation, source, created_at
     FROM address_book WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  )

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      googleAccountId: user.google_id,
      createdAt: user.created_at.toISOString(),
    },
    campaigns: campaigns.rows.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      type: row.type,
      attachmentNames: row.attachment_names ?? [],
      status: row.status,
      mailsPerDay: row.mails_per_day,
      startHour: row.start_hour,
      pauseMs: row.pause_ms,
      timezone: row.timezone,
      createdAt: row.created_at.toISOString(),
      startedAt: iso(row.started_at),
      completedAt: iso(row.completed_at),
      contacts: contactsByCampaign.get(row.id) ?? [],
      logs: logsByCampaign.get(row.id) ?? [],
    })),
    addressBook: book.rows.map((row) => ({
      email: row.email,
      contactName: row.contact_name,
      companyName: row.company_name,
      salutation: row.salutation,
      source: row.source,
      createdAt: row.created_at.toISOString(),
    })),
  }
}

/**
 * Every contact of every campaign as one CSV: the part of the export a person
 * most often wants to open in a spreadsheet or bring elsewhere.
 *
 * The same cell rules as the log export — quoted, and neutralised when a
 * spreadsheet would run the value as a formula — because these addresses came
 * from an imported file.
 */
export function contactsToCsv(data: UserExport): string {
  const header = [
    'campagne',
    'adresse',
    'nom',
    'entreprise',
    'civilite',
    'statut',
    'envoye_le',
    'erreur',
  ]
    .map(csvCell)
    .join(',')

  const lines = data.campaigns.flatMap((campaign) =>
    campaign.contacts.map((contact) =>
      [
        campaign.name,
        contact.email,
        contact.contactName ?? '',
        contact.companyName ?? '',
        contact.salutation ?? '',
        contact.status,
        contact.sentAt ?? '',
        contact.errorMessage ?? '',
      ]
        .map(csvCell)
        .join(','),
    ),
  )

  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}
