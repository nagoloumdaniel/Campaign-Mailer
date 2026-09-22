import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createCampaignRepository } from './campaigns.js'
import { renderPreview } from './preview.js'

/**
 * Exercises the campaign path against a real PostgreSQL, which the unit tests
 * cannot: the fakes prove the routes behave, not that the SQL does.
 *
 * Skipped when DATABASE_URL is absent, so `npm test` still runs on a machine
 * or a pipeline with no database. A pool is built here rather than imported
 * from db/pool, which would pull in the whole configuration module and demand
 * every other variable.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let userId: string
const stamp = Date.now()

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`itest-${stamp}`, `itest-${stamp}@example.test`],
  )
  const created = rows[0]
  assert.ok(created, 'the test user was not created')
  userId = created.id
})

after(async () => {
  if (!enabled) {
    return
  }

  // The cascade takes the campaigns and contacts with the account. By its exact
  // id: a prefix would also delete the accounts of the files running beside
  // this one, mid-test.
  await pool.query('DELETE FROM users WHERE google_id = $1', [`itest-${String(stamp)}`])
  await pool.end()
})

describe(
  'a campaign in the database',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('renders a preview from a stored contact, end to end', async () => {
      const { rows: campaigns } = await pool.query<{ id: string }>(
        `INSERT INTO campaigns (user_id, name, subject, body_html, body_text)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          userId,
          'Intégration',
          'Candidature chez {{company_name|votre équipe}}',
          '<p>Bonjour {{salutation|Madame, Monsieur}}, chez {{company_name}}</p>',
          'Bonjour {{salutation|Madame, Monsieur}}',
        ],
      )
      const created = campaigns[0]
      assert.ok(created)
      const campaignId = created.id

      // A contact whose values would break a naive merge: markup, an accent and
      // an ampersand, which is what a real CSV eventually contains.
      await pool.query(
        `INSERT INTO contacts (campaign_id, email, contact_name, company_name, salutation)
       VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, 'zoe@exemple.fr', 'Zoé <b>Martin</b>', 'Dupont & Fils', null],
      )

      const { rows: stored } = await pool.query<{
        subject: string
        body_html: string
        body_text: string
        email: string
        contact_name: string | null
        company_name: string | null
        salutation: string | null
      }>(
        `SELECT c.subject, c.body_html, c.body_text,
              ct.email, ct.contact_name, ct.company_name, ct.salutation
       FROM campaigns c JOIN contacts ct ON ct.campaign_id = c.id
       WHERE c.id = $1`,
        [campaignId],
      )

      const row = stored[0]
      assert.ok(row)

      const preview = renderPreview(row, row)

      assert.equal(preview.subject, 'Candidature chez Dupont & Fils')
      // Escaped in the HTML body…
      assert.ok(preview.bodyHtml.includes('Dupont &amp; Fils'))
      assert.ok(!preview.bodyHtml.includes('<b>Martin</b>'))
      // The stored salutation is null, and a preview fills a gap with the
      // sample value rather than with the template's fallback: the point of a
      // preview is to show a complete message. The fallback is what a real send
      // would use, and template.test.ts covers that path.
      assert.ok(preview.bodyText.includes('Madame'))
      assert.ok(!preview.bodyText.includes('{{'))
      assert.equal(preview.contact.salutation, 'Madame')
    })

    it('refuses any start hour but the opening of the window, even without the API', async () => {
      // The CHECK constraint is the boundary a script cannot walk around.
      for (const hour of [10, 24]) {
        await assert.rejects(
          pool.query(
            'INSERT INTO campaigns (user_id, name, start_hour) VALUES ($1, $2, $3)',
            [userId, 'Mauvaise heure', hour],
          ),
        )
      }
    })

    it('refuses a pace the account cannot bear, even without the API', async () => {
      for (const [column, value] of [
        ['pause_ms', 9_999],
        ['mails_per_day', 451],
      ] as const) {
        await assert.rejects(
          pool.query(
            `INSERT INTO campaigns (user_id, name, ${column}) VALUES ($1, $2, $3)`,
            [userId, 'Trop rapide', value],
          ),
          `${column} = ${String(value)} was accepted`,
        )
      }
    })

    it('paces a new campaign at thirty seconds by default', async () => {
      const repository = createCampaignRepository(pool)
      const created = await repository.create(userId, { name: 'Par défaut' })

      assert.equal(created.pause_ms, 30_000)
    })

    it('moves a campaign only from the states it names, once', async () => {
      // The route tests use a fake; this is the SQL itself — the enum casts, the
      // ANY over an array, and the conditional that makes a double click lose.
      const repository = createCampaignRepository(pool)
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id',
        [userId, 'Transitions'],
      )
      const created = rows[0]
      assert.ok(created)

      const scheduled = await repository.transition(created.id, ['draft'], 'scheduled')
      assert.equal(scheduled?.status, 'scheduled')
      assert.ok(scheduled.scheduled_at instanceof Date, 'scheduling stamps scheduled_at')

      assert.equal(
        await repository.transition(created.id, ['draft'], 'scheduled'),
        null,
        'the second start of a double click must find nothing to move',
      )

      const paused = await repository.transition(
        created.id,
        ['scheduled', 'running'],
        'paused',
      )
      assert.equal(paused?.status, 'paused')
      assert.equal(
        paused.scheduled_at?.getTime(),
        scheduled.scheduled_at.getTime(),
        'only scheduling stamps the date',
      )
    })

    it('counts only the contacts still waiting to be sent', async () => {
      const repository = createCampaignRepository(pool)
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id',
        [userId, 'Comptage'],
      )
      const created = rows[0]
      assert.ok(created)

      await pool.query(
        `INSERT INTO contacts (campaign_id, email, status) VALUES
         ($1, 'a@exemple.fr', 'pending'), ($1, 'b@exemple.fr', 'pending'),
         ($1, 'c@exemple.fr', 'sent'), ($1, 'd@exemple.fr', 'ignored')`,
        [created.id],
      )

      assert.equal(await repository.countPendingContacts(created.id), 2)
    })

    it('refuses the same address twice in one campaign, whatever the case', async () => {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id',
        [userId, 'Doublons'],
      )
      const created = rows[0]
      assert.ok(created)
      const campaignId = created.id

      await pool.query('INSERT INTO contacts (campaign_id, email) VALUES ($1, $2)', [
        campaignId,
        'Marie@Exemple.fr',
      ])

      await assert.rejects(
        pool.query('INSERT INTO contacts (campaign_id, email) VALUES ($1, $2)', [
          campaignId,
          'marie@exemple.fr',
        ]),
      )
    })
  },
)
