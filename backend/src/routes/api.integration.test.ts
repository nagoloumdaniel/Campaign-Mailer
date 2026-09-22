import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import session from 'express-session'
import pg from 'pg'

import { openSession } from '../e2e/session.js'

/**
 * The API over HTTP, as the web app calls it, against a real PostgreSQL.
 *
 * The route tests beside this file use fakes and prove each route's decisions.
 * This one builds the real application — helmet, the session, Passport, the
 * rate limit, the terms gate, the repositories — and follows one user from
 * sign-in to a paused campaign, with a second account trying to reach it.
 *
 * Sign-in without Google: a session is written into an in-memory store and its
 * id signed the way express-session signs it. No route or flag in the
 * application exists for tests, so nothing here can be switched on in
 * production.
 *
 * Run it on a throwaway schema: `npm run test:integration`. Skipped without
 * DATABASE_URL or the rest of the backend configuration.
 */
const DATABASE_URL = process.env.DATABASE_URL
const SESSION_SECRET = process.env.SESSION_SECRET ?? ''

const loaded = DATABASE_URL
  ? await Promise.all([import('../app.js'), import('../services/terms.js')]).catch(
      () => null,
    )
  : null

const stamp = `api-itest-${String(Date.now())}-${String(process.pid)}`
const store = new session.MemoryStore()
const dispatched: string[] = []

let pool: pg.Pool
let server: Server
let baseUrl: string
let alice: { id: string; cookie: string }
let bob: { id: string; cookie: string }

async function signIn(name: string): Promise<{ id: string; cookie: string }> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`${stamp}-${name}`, `${name}-${stamp}@example.test`],
  )
  const id = rows[0]?.id
  assert.ok(id)

  const { header } = await openSession(store, id, SESSION_SECRET)
  return { id, cookie: header }
}

async function call(
  path: string,
  options: { as?: { cookie: string }; method?: string; body?: unknown } = {},
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.as ? { cookie: options.as.cookie } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null,
  }
}

before(async () => {
  if (!loaded) {
    return
  }
  const [{ createApp }] = loaded

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

  const app = createApp({
    sessionStore: store,
    requestDispatch: (campaignId) => {
      dispatched.push(campaignId)
      return Promise.resolve()
    },
  })

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`

  alice = await signIn('alice')
  bob = await signIn('bob')
})

after(async () => {
  if (!loaded) {
    return
  }

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  await pool.query('DELETE FROM audit_events WHERE actor_id = ANY($1::uuid[])', [
    [alice.id, bob.id],
  ])
  await pool.query('DELETE FROM users WHERE google_id LIKE $1', [`${stamp}-%`])
  await pool.end()
})

describe(
  'the API, from sign-in to a paused campaign',
  { skip: loaded ? false : 'DATABASE_URL or the backend configuration is not set' },
  () => {
    let campaignId: string

    it('refuses a request without a session', async () => {
      assert.equal((await call('/api/auth/me')).status, 401)
      assert.equal((await call('/api/campaigns')).status, 401)
    })

    it('recognizes the user from the session, and asks for the terms first', async () => {
      const me = await call('/api/auth/me', { as: alice })

      assert.equal(me.status, 200)
      assert.deepEqual(
        {
          id: (me.body?.user as { id: string }).id,
          terms: (me.body?.user as { termsVersion: unknown }).termsVersion,
        },
        { id: alice.id, terms: null },
      )

      const gated = await call('/api/campaigns', { as: alice })
      assert.ok(gated.status >= 400 && gated.status < 500, `got ${String(gated.status)}`)
    })

    it('opens the service once the current terms are accepted', async () => {
      const version = loaded?.[1].CURRENT_TERMS_VERSION

      const accepted = await call('/api/users/me/terms', {
        as: alice,
        method: 'POST',
        body: { version },
      })
      assert.ok(accepted.status < 300, `got ${String(accepted.status)}`)

      await pool.query('UPDATE users SET terms_version = $1 WHERE id = $2', [
        version,
        bob.id,
      ])

      const listed = await call('/api/campaigns', { as: alice })
      assert.equal(listed.status, 200)
      assert.deepEqual(listed.body?.campaigns, [])
    })

    it('creates a campaign and imports contacts, reporting the rows it refused', async () => {
      const created = await call('/api/campaigns', {
        as: alice,
        method: 'POST',
        body: {
          name: 'Candidatures',
          subject: 'Candidature chez {{company_name|votre équipe}}',
          body_html: '<p>Bonjour {{contact_name|Madame, Monsieur}}</p>',
          timezone: 'Europe/Paris',
        },
      })
      assert.equal(created.status, 201)
      campaignId = (created.body?.campaign as { id: string }).id

      const imported = await call(`/api/campaigns/${campaignId}/contacts/import`, {
        as: alice,
        method: 'POST',
        body: {
          rows: [
            { email: 'ana@example.test', contact_name: 'Ana', company_name: 'Acme' },
            { email: 'not-an-address' },
            { email: 'ANA@example.test' },
            { email: 'bob@example.test' },
          ],
        },
      })

      assert.equal(imported.status, 201)
      const report = imported.body?.report as {
        read: number
        imported: number
        rejected: unknown[]
      }
      assert.equal(report.read, 4)
      assert.equal(report.imported, 2)
      assert.equal(report.rejected.length, 2)

      const listed = await call(`/api/campaigns/${campaignId}/contacts`, { as: alice })
      assert.equal(listed.status, 200)
      assert.equal(listed.body?.total, 2)
    })

    it('hides the campaign from another account, as if it did not exist', async () => {
      assert.equal((await call(`/api/campaigns/${campaignId}`, { as: bob })).status, 404)
      assert.equal(
        (await call(`/api/campaigns/${campaignId}/contacts`, { as: bob })).status,
        404,
      )
      assert.equal(
        (await call(`/api/campaigns/${campaignId}/start`, { as: bob, method: 'POST' }))
          .status,
        404,
      )
      assert.deepEqual((await call('/api/campaigns', { as: bob })).body?.campaigns, [])
    })

    it('launches the campaign once and hands it to the worker', async () => {
      const started = await call(`/api/campaigns/${campaignId}/start`, {
        as: alice,
        method: 'POST',
      })

      assert.equal(started.status, 200)
      assert.equal((started.body?.campaign as { status: string }).status, 'scheduled')
      assert.deepEqual(dispatched, [campaignId])

      const again = await call(`/api/campaigns/${campaignId}/start`, {
        as: alice,
        method: 'POST',
      })
      assert.equal(again.status, 409)
    })

    it('refuses an import once the campaign is scheduled', async () => {
      const late = await call(`/api/campaigns/${campaignId}/contacts/import`, {
        as: alice,
        method: 'POST',
        body: { rows: [{ email: 'late@example.test' }] },
      })

      assert.equal(late.status, 409)
    })

    it('follows the campaign on its page and on the dashboard', async () => {
      assert.equal(
        (await call(`/api/campaigns/${campaignId}/stats`, { as: alice })).status,
        200,
      )

      const dashboard = await call('/api/dashboard', { as: alice })
      assert.equal(dashboard.status, 200)
      assert.ok(JSON.stringify(dashboard.body).includes(campaignId))
    })

    it('pauses it, and records the launch and the pause in the audit log', async () => {
      const paused = await call(`/api/campaigns/${campaignId}/pause`, {
        as: alice,
        method: 'POST',
      })
      assert.equal(paused.status, 200)
      assert.equal((paused.body?.campaign as { status: string }).status, 'paused')

      const { rows } = await pool.query<{ action: string }>(
        `SELECT action FROM audit_events
         WHERE actor_id = $1 AND target_id = $2 ORDER BY created_at`,
        [alice.id, campaignId],
      )
      assert.deepEqual(
        rows.map((row) => row.action),
        ['campaign.started', 'campaign.paused'],
      )
    })
  },
)
