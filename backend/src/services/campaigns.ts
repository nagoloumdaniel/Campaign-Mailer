import type { Pool } from 'pg'

import type { CampaignOwnershipRepository } from '../middleware/auth.js'
import type { CampaignType } from '../schemas/campaign.js'
import type { CampaignStatus } from './campaignState.js'
import { countSentToday } from './sendEngine.js'

export interface CampaignRow {
  id: string
  user_id: string
  name: string
  type: CampaignType
  subject: string | null
  body_html: string | null
  body_text: string | null
  status: CampaignStatus
  total_contacts: number
  sent_count: number
  error_count: number
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
  created_at: Date
  updated_at: Date
  scheduled_at: Date | null
  started_at: Date | null
  completed_at: Date | null
}

/** One stored file of a campaign, in upload order. */
export interface CampaignAttachmentRow {
  id: string
  campaign_id: string
  object_key: string
  name: string
  size_bytes: number | null
  content_type: string
  created_at: Date
}

/**
 * How many files one campaign may carry.
 *
 * Gmail refuses a message much past ten megabytes once base64 inflates it, and
 * each file is capped at ten on its own, so five is a cap on the clutter
 * rather than on the bytes: past a CV, a cover letter and a transcript, a
 * recipient stops opening them.
 */
export const MAX_ATTACHMENTS = 5

/** The fields a client may set. Counters and timestamps are the server's. */
export interface CampaignWritableFields {
  name: string
  type: CampaignType
  subject: string | null
  body_html: string | null
  body_text: string | null
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
}

/**
 * Columns returned to a client. Written out rather than SELECT *, so a column
 * added later is not exposed by accident.
 */
const COLUMNS = `
  id, user_id, name, type, subject, body_html, body_text, status,
  total_contacts, sent_count, error_count,
  mails_per_day, start_hour, pause_ms, timezone,
  created_at, updated_at, scheduled_at, started_at, completed_at
`

const ATTACHMENT_COLUMNS = `
  id, campaign_id, object_key, name, size_bytes, content_type, created_at
`

/**
 * A patch, with `undefined` spelled out.
 *
 * `exactOptionalPropertyTypes` is on, so `Partial<T>` would not accept the
 * shape Zod infers, where an absent optional field is explicitly `undefined`.
 */
export type CampaignPatch = {
  [K in keyof CampaignWritableFields]?: CampaignWritableFields[K] | undefined
}

/** The merge fields of one contact, for a preview. Contacts land fully in Phase 3. */
export interface PreviewContactRow {
  id: string
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
}

export interface CampaignRepository extends CampaignOwnershipRepository {
  findContact(campaignId: string, contactId: string): Promise<PreviewContactRow | null>
  listForUser(userId: string): Promise<CampaignRow[]>
  create(userId: string, input: CampaignPatch & { name: string }): Promise<CampaignRow>
  findForUser(campaignId: string, userId: string): Promise<CampaignRow | null>
  update(campaignId: string, patch: CampaignPatch): Promise<CampaignRow | null>
  /** A campaign's files, oldest first. */
  listAttachments(campaignId: string): Promise<CampaignAttachmentRow[]>
  findAttachment(
    campaignId: string,
    attachmentId: string,
  ): Promise<CampaignAttachmentRow | null>
  /**
   * Stores one more file, unless the campaign already holds `MAX_ATTACHMENTS`.
   * Null when the cap is reached, so the caller can delete the object it has
   * just uploaded rather than leaving it orphaned.
   */
  addAttachment(
    campaignId: string,
    attachment: {
      object_key: string
      name: string
      size_bytes: number
      content_type: string
    },
  ): Promise<CampaignAttachmentRow | null>
  removeAttachment(campaignId: string, attachmentId: string): Promise<boolean>
  /**
   * Creates a campaign holding copies of contacts taken from the user's other
   * campaigns. Returns the campaign and how many contacts it received; the
   * unique index on (campaign_id, lower(email)) collapses duplicates, so a
   * selection naming one address twice produces one contact.
   */
  createFollowUp(
    userId: string,
    input: { name: string; type: CampaignType; contactIds: readonly string[] },
  ): Promise<{ campaign: CampaignRow; imported: number }>
  remove(campaignId: string): Promise<boolean>
  /**
   * Moves the campaign to `to` only if it is still in one of `from`. Null when
   * it was not: another request moved it first.
   */
  transition(
    campaignId: string,
    from: readonly CampaignStatus[],
    to: CampaignStatus,
  ): Promise<CampaignRow | null>
  countPendingContacts(campaignId: string): Promise<number>
  /** What the account sent over the last 24 hours, across every campaign. */
  accountSentLast24h(userId: string): Promise<number>
}

/** Column names a patch may touch, so a key from a payload never reaches SQL. */
const PATCHABLE = new Set<keyof CampaignWritableFields>([
  'name',
  'type',
  'subject',
  'body_html',
  'body_text',
  'mails_per_day',
  'start_hour',
  'pause_ms',
  'timezone',
])

export function createCampaignRepository(pool: Pool): CampaignRepository {
  return {
    async belongsTo(campaignId, userId) {
      // Both conditions in one query. Fetching the campaign and comparing in
      // JavaScript would pull a row the caller is not allowed to see into
      // memory, and into any log that dumps it.
      const { rows } = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM campaigns WHERE id = $1 AND user_id = $2) AS exists',
        [campaignId, userId],
      )

      return rows[0]?.exists ?? false
    },

    async listForUser(userId) {
      const { rows } = await pool.query<CampaignRow>(
        `SELECT ${COLUMNS} FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      )

      return rows
    },

    async create(userId, input) {
      const { rows } = await pool.query<CampaignRow>(
        `INSERT INTO campaigns (user_id, name, type, subject, body_html, body_text,
                                mails_per_day, start_hour, pause_ms, timezone)
         VALUES ($1, $2, COALESCE($3::campaign_type, 'autre'), $4, $5, $6,
                 COALESCE($7, 46), COALESCE($8, 10), COALESCE($9, 30000), COALESCE($10, 'Europe/Paris'))
         RETURNING ${COLUMNS}`,
        [
          userId,
          input.name,
          input.type ?? null,
          input.subject ?? null,
          input.body_html ?? null,
          input.body_text ?? null,
          input.mails_per_day ?? null,
          input.start_hour ?? null,
          input.pause_ms ?? null,
          input.timezone ?? null,
        ],
      )

      const row = rows[0]

      if (!row) {
        throw new Error('Campaign insert returned no row')
      }

      return row
    },

    async findForUser(campaignId, userId) {
      const { rows } = await pool.query<CampaignRow>(
        `SELECT ${COLUMNS} FROM campaigns WHERE id = $1 AND user_id = $2`,
        [campaignId, userId],
      )

      return rows[0] ?? null
    },

    async update(campaignId, patch) {
      // The column names come from the allowlist above, never from the keys of
      // the payload, so no caller-supplied string can become an identifier in
      // the statement. The values are read through a Map rather than by
      // indexing the payload with a variable.
      const supplied = new Map(Object.entries(patch))
      const columns = [...PATCHABLE].filter((column) => supplied.has(column))

      if (columns.length === 0) {
        // The schema refuses an empty patch, so reaching here is a programming
        // error rather than a bad request. Failing loudly beats returning a
        // row that was never updated.
        throw new Error('update called with no patchable field')
      }

      const assignments = columns.map(
        (column, index) => `${column} = $${String(index + 2)}`,
      )
      const values = columns.map((column) => supplied.get(column) ?? null)

      const { rows } = await pool.query<CampaignRow>(
        `UPDATE campaigns SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
        [campaignId, ...values],
      )

      return rows[0] ?? null
    },

    async findContact(campaignId, contactId) {
      // Scoped by campaign as well as by id, so a contact id from another
      // campaign cannot be previewed through this one.
      const { rows } = await pool.query<PreviewContactRow>(
        `SELECT id, email, contact_name, company_name, salutation
         FROM contacts WHERE id = $1 AND campaign_id = $2`,
        [contactId, campaignId],
      )

      return rows[0] ?? null
    },

    async listAttachments(campaignId) {
      const { rows } = await pool.query<CampaignAttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM campaign_attachments
         WHERE campaign_id = $1 ORDER BY created_at, id`,
        [campaignId],
      )

      return rows
    },

    async findAttachment(campaignId, attachmentId) {
      // Scoped by campaign as well as by id, so an attachment of another
      // campaign cannot be downloaded or deleted through this one.
      const { rows } = await pool.query<CampaignAttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM campaign_attachments
         WHERE id = $1 AND campaign_id = $2`,
        [attachmentId, campaignId],
      )

      return rows[0] ?? null
    },

    async addAttachment(campaignId, attachment) {
      // The cap is checked inside the INSERT rather than by a count followed
      // by a write: two uploads finishing at once would both read four and
      // both insert. The SELECT in the WHERE clause is evaluated by the same
      // statement that writes.
      const { rows } = await pool.query<CampaignAttachmentRow>(
        `INSERT INTO campaign_attachments (campaign_id, object_key, name, size_bytes, content_type)
         SELECT $1, $2, $3, $4, $5
         WHERE (SELECT count(*) FROM campaign_attachments WHERE campaign_id = $1) < ${String(MAX_ATTACHMENTS)}
         RETURNING ${ATTACHMENT_COLUMNS}`,
        [
          campaignId,
          attachment.object_key,
          attachment.name,
          attachment.size_bytes,
          attachment.content_type,
        ],
      )

      return rows[0] ?? null
    },

    async removeAttachment(campaignId, attachmentId) {
      const result = await pool.query(
        'DELETE FROM campaign_attachments WHERE id = $1 AND campaign_id = $2',
        [attachmentId, campaignId],
      )

      return (result.rowCount ?? 0) > 0
    },

    async createFollowUp(userId, input) {
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const { rows } = await client.query<CampaignRow>(
          `INSERT INTO campaigns (user_id, name, type)
           VALUES ($1, $2, $3::campaign_type)
           RETURNING ${COLUMNS}`,
          [userId, input.name, input.type],
        )

        const campaign = rows[0]

        if (!campaign) {
          throw new Error('Follow-up campaign insert returned no row')
        }

        // The source contacts are re-read here, joined to their campaign and
        // filtered by owner: an id from another account selects nothing rather
        // than copying a stranger's address into this campaign.
        const copied = await client.query(
          `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation)
           SELECT $1, ct.email, ct.contact_name, ct.company_name, ct.salutation
           FROM contacts ct
           JOIN campaigns src ON src.id = ct.campaign_id
           WHERE ct.id = ANY($2::uuid[]) AND src.user_id = $3
           ON CONFLICT DO NOTHING`,
          [campaign.id, input.contactIds, userId],
        )

        const imported = copied.rowCount ?? 0

        const { rows: updated } = await client.query<CampaignRow>(
          `UPDATE campaigns SET total_contacts = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
          [campaign.id, imported],
        )

        await client.query('COMMIT')

        return { campaign: updated[0] ?? campaign, imported }
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },

    async remove(campaignId) {
      const result = await pool.query('DELETE FROM campaigns WHERE id = $1', [campaignId])

      return (result.rowCount ?? 0) > 0
    },

    async transition(campaignId, from, to) {
      // One conditional statement, so two clicks on "start", or a pause racing
      // the planner, cannot both win. The route has already checked the graph;
      // this checks that nothing moved since.
      const { rows } = await pool.query<CampaignRow>(
        `UPDATE campaigns
         SET status = $3::campaign_status,
             scheduled_at = CASE WHEN $3::campaign_status = 'scheduled'
                                 THEN now() ELSE scheduled_at END
         WHERE id = $1 AND status = ANY($2::campaign_status[])
         RETURNING ${COLUMNS}`,
        [campaignId, from, to],
      )

      return rows[0] ?? null
    },

    async accountSentLast24h(userId) {
      // The same count the send engine checks against the ceiling, so what the
      // user reads and what holds the sending cannot disagree.
      return countSentToday(pool, userId)
    },

    async countPendingContacts(campaignId) {
      const { rows } = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM contacts
         WHERE campaign_id = $1 AND status = 'pending'`,
        [campaignId],
      )

      return Number(rows[0]?.total ?? 0)
    },
  }
}
