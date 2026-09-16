import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  MAX_ATTACHMENTS,
  createCampaignRepository,
  type CampaignRepository,
} from './campaigns.js'

/**
 * The campaign repository's SQL against a real PostgreSQL: the defaults a new
 * campaign takes, the allowlist a patch goes through, ownership checks that
 * live in the WHERE clause, and a status change that only one caller can win.
 *
 * Skipped when DATABASE_URL is absent. Rows are removed by their exact Google
 * id, so a file running beside this one keeps its own.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const googleId = `itest-campaign-repo-${String(Date.now())}-${String(process.pid)}`
const NOBODY = '00000000-0000-4000-8000-000000000000'

let pool: pg.Pool
let campaigns: CampaignRepository
let userId: string

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  campaigns = createCampaignRepository(pool)

  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [googleId, `${googleId}@example.test`],
  )
  assert.ok(rows[0])
  userId = rows[0].id
})

after(async () => {
  if (!enabled) {
    return
  }

  await pool.query('DELETE FROM users WHERE google_id = $1', [googleId])
  await pool.end()
})

describe(
  'the campaign repository',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('creates a draft with the sending defaults', async () => {
      const created = await campaigns.create(userId, { name: 'Defaults' })

      assert.deepEqual(
        {
          status: created.status,
          mails_per_day: created.mails_per_day,
          start_hour: created.start_hour,
          pause_ms: created.pause_ms,
          timezone: created.timezone,
          total_contacts: created.total_contacts,
        },
        {
          status: 'draft',
          mails_per_day: 46,
          start_hour: 10,
          pause_ms: 30_000,
          timezone: 'Europe/Paris',
          total_contacts: 0,
        },
      )
    })

    it('finds a campaign for its owner only', async () => {
      const created = await campaigns.create(userId, { name: 'Owned' })

      assert.equal(await campaigns.belongsTo(created.id, userId), true)
      assert.equal(await campaigns.belongsTo(created.id, NOBODY), false)
      assert.equal((await campaigns.findForUser(created.id, userId))?.name, 'Owned')
      assert.equal(await campaigns.findForUser(created.id, NOBODY), null)
    })

    it('lists an account’s campaigns, newest first', async () => {
      const newest = await campaigns.create(userId, { name: 'Newest' })
      const listed = await campaigns.listForUser(userId)

      assert.equal(listed[0]?.id, newest.id)
      assert.ok(listed.every((row) => row.user_id === userId))
      assert.equal((await campaigns.listForUser(NOBODY)).length, 0)
    })

    it('updates the fields a patch names, and refuses a patch that names none', async () => {
      const created = await campaigns.create(userId, { name: 'Before' })

      const updated = await campaigns.update(created.id, {
        name: 'After',
        pause_ms: 45_000,
        subject: undefined,
      })

      assert.equal(updated?.name, 'After')
      assert.equal(updated.pause_ms, 45_000)
      assert.equal(updated.timezone, 'Europe/Paris')
      await assert.rejects(campaigns.update(created.id, {}), /no patchable field/)
      assert.equal(await campaigns.update(NOBODY, { name: 'Ghost' }), null)
    })

    it('adds attachments in upload order, and removes one at a time', async () => {
      const created = await campaigns.create(userId, { name: 'Attachment' })

      const cv = await campaigns.addAttachment(created.id, {
        object_key: `campaigns/${created.id}/cv.pdf`,
        name: 'CV.pdf',
        size_bytes: 1024,
        content_type: 'application/pdf',
      })
      await campaigns.addAttachment(created.id, {
        object_key: `campaigns/${created.id}/lm.pdf`,
        name: 'Lettre.pdf',
        size_bytes: 2048,
        content_type: 'application/pdf',
      })

      assert.deepEqual(
        (await campaigns.listAttachments(created.id)).map((file) => file.name),
        ['CV.pdf', 'Lettre.pdf'],
      )

      assert.equal(
        (await campaigns.findAttachment(created.id, cv?.id ?? NOBODY))?.name,
        'CV.pdf',
      )
      // Scoped by campaign: an id of another campaign is simply not found.
      assert.equal(await campaigns.findAttachment(NOBODY, cv?.id ?? NOBODY), null)

      assert.equal(await campaigns.removeAttachment(created.id, cv?.id ?? NOBODY), true)
      assert.equal((await campaigns.listAttachments(created.id)).length, 1)
    })

    it('refuses a sixth attachment rather than growing without a bound', async () => {
      const created = await campaigns.create(userId, { name: 'Five files' })

      for (let index = 0; index < MAX_ATTACHMENTS; index += 1) {
        const stored = await campaigns.addAttachment(created.id, {
          object_key: `campaigns/${created.id}/${String(index)}.pdf`,
          name: `Fichier ${String(index)}.pdf`,
          size_bytes: 1024,
          content_type: 'application/pdf',
        })
        assert.ok(stored, 'the cap refused a file below the limit')
      }

      const refused = await campaigns.addAttachment(created.id, {
        object_key: `campaigns/${created.id}/six.pdf`,
        name: 'Sixieme.pdf',
        size_bytes: 1024,
        content_type: 'application/pdf',
      })

      assert.equal(refused, null)
      assert.equal((await campaigns.listAttachments(created.id)).length, MAX_ATTACHMENTS)
    })

    it('builds a follow-up from contacts of the user’s own campaigns', async () => {
      const source = await campaigns.create(userId, { name: 'Source' })
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name, status)
         VALUES ($1, 'ana@exemple.fr', 'Ana', 'Acme', 'sent'),
                ($1, 'bob@exemple.fr', 'Bob', 'Globex', 'failed')
         RETURNING id`,
        [source.id],
      )
      const ids = rows.map((row) => row.id)

      const { campaign, imported } = await campaigns.createFollowUp(userId, {
        name: 'Relance',
        type: 'relance',
        contactIds: ids,
      })

      assert.equal(imported, 2)
      assert.equal(campaign.type, 'relance')
      assert.equal(campaign.status, 'draft')
      // The counter is written in the same transaction as the copy.
      assert.equal(campaign.total_contacts, 2)

      const copied = await pool.query<{ email: string; status: string; name: string }>(
        `SELECT email, status, contact_name AS name FROM contacts
         WHERE campaign_id = $1 ORDER BY email`,
        [campaign.id],
      )

      assert.deepEqual(
        copied.rows.map((row) => row.email),
        ['ana@exemple.fr', 'bob@exemple.fr'],
      )
      // Copied as pending, whatever happened to them the first time round.
      assert.ok(copied.rows.every((row) => row.status === 'pending'))
      assert.equal(copied.rows[0]?.name, 'Ana')
    })

    it('copies an address named twice only once', async () => {
      const source = await campaigns.create(userId, { name: 'Twice' })
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email) VALUES ($1, 'same@exemple.fr')
         RETURNING id`,
        [source.id],
      )
      const id = rows[0]?.id ?? NOBODY

      const { imported } = await campaigns.createFollowUp(userId, {
        name: 'Relance en double',
        type: 'relance',
        contactIds: [id, id],
      })

      assert.equal(imported, 1)
    })

    it('copies nothing from a contact that is not the user’s', async () => {
      // The ids come from a page the user was shown, but the copy is scoped by
      // owner in SQL rather than trusted: an id from another account selects
      // nothing at all.
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
        [`${googleId}-stranger`, `${googleId}-stranger@example.test`],
      )
      const strangerId = rows[0]?.id
      assert.ok(strangerId)

      const theirs = await campaigns.create(strangerId, { name: 'Leur campagne' })
      const contact = await pool.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email) VALUES ($1, 'them@exemple.fr')
         RETURNING id`,
        [theirs.id],
      )

      const { imported } = await campaigns.createFollowUp(userId, {
        name: 'Relance volée',
        type: 'relance',
        contactIds: [contact.rows[0]?.id ?? NOBODY],
      })

      assert.equal(imported, 0)

      await pool.query('DELETE FROM users WHERE id = $1', [strangerId])
    })

    it('previews a contact through its own campaign only, and counts the pending ones', async () => {
      const first = await campaigns.create(userId, { name: 'First' })
      const second = await campaigns.create(userId, { name: 'Second' })
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email, contact_name, status)
         VALUES ($1, 'a@example.test', 'Ana', 'pending'),
                ($1, 'b@example.test', NULL, 'pending'),
                ($1, 'c@example.test', NULL, 'ignored')
         RETURNING id`,
        [first.id],
      )
      const contactId = rows[0]?.id
      assert.ok(contactId)

      assert.equal(
        (await campaigns.findContact(first.id, contactId))?.contact_name,
        'Ana',
      )
      assert.equal(await campaigns.findContact(second.id, contactId), null)
      assert.equal(await campaigns.countPendingContacts(first.id), 2)
      assert.equal(await campaigns.countPendingContacts(second.id), 0)
    })

    it('moves a status once: the second caller finds it already moved', async () => {
      const created = await campaigns.create(userId, { name: 'Race' })

      const won = await campaigns.transition(created.id, ['draft'], 'scheduled')
      const lost = await campaigns.transition(created.id, ['draft'], 'scheduled')

      assert.equal(won?.status, 'scheduled')
      assert.ok(won.scheduled_at, 'scheduling did not stamp the time')
      assert.equal(lost, null)
    })

    it('counts nothing sent for an account that has not sent', async () => {
      assert.equal(await campaigns.accountSentLast24h(userId), 0)
    })

    it('removes a campaign once', async () => {
      const created = await campaigns.create(userId, { name: 'Removed' })

      assert.equal(await campaigns.remove(created.id), true)
      assert.equal(await campaigns.remove(created.id), false)
    })
  },
)
