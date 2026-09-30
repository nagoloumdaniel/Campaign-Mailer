import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import session from 'express-session'
import pg from 'pg'

/**
 * The v1 API over HTTP, against a real PostgreSQL and the real application:
 * the token, the terms gate, the rate limit, the idempotency and the import
 * rules, with a second account trying to reach the first one's draft.
 *
 * Run it on a throwaway schema: `npm run test:integration`. Skipped without
 * DATABASE_URL or the rest of the backend configuration.
 */
const DATABASE_URL = process.env.DATABASE_URL

const loaded = DATABASE_URL
  ? await Promise.all([
      import('../app.js'),
      import('../services/terms.js'),
      import('../services/integrationTokens.js'),
    ]).catch(() => null)
  : null

const stamp = `v1-itest-${String(Date.now())}-${String(process.pid)}`

let pool: pg.Pool
let server: Server
let baseUrl: string
let token: string
let otherToken: string
let readOnlyToken: string
let userId: string

async function account(name: string, scopes: ('campaigns:write' | 'contacts:write')[]) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, terms_version, terms_accepted_at)
     VALUES ($1, $2, $3, now()) RETURNING id`,
    [
      `${stamp}-${name}`,
      `${name}-${stamp}@example.test`,
      loaded?.[1].CURRENT_TERMS_VERSION,
    ],
  )
  const id = rows[0]?.id
  assert.ok(id && loaded)
  const created = await loaded[2]
    .createIntegrationTokenRepository(pool)
    .create(id, name, scopes)
  assert.equal(created.kind, 'created')
  return { id, secret: created.secret }
}

async function call(
  path: string,
  options: { secret?: string; key?: string; body?: unknown; method?: string } = {},
) {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.secret ? { authorization: `Bearer ${options.secret}` } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await res.text()
  return { res, body: (text ? JSON.parse(text) : null) as Record<string, unknown> }
}

describe('the v1 API', { skip: !loaded }, () => {
  before(async () => {
    assert.ok(loaded)
    pool = new pg.Pool({ connectionString: DATABASE_URL })
    const alice = await account('alice', ['campaigns:write', 'contacts:write'])
    const bob = await account('bob', ['campaigns:write', 'contacts:write'])
    const carol = await account('carol', ['contacts:write'])
    userId = alice.id
    token = alice.secret
    otherToken = bob.secret
    readOnlyToken = carol.secret

    const app = loaded[0].createApp({ sessionStore: new session.MemoryStore() })
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        resolve()
      })
    })
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  })

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    await pool.query('DELETE FROM users WHERE google_id LIKE $1', [`${stamp}-%`])
    await pool.end()
  })

  it('refuses a request without a valid token, and opens no session', async () => {
    const none = await call('/campaigns', { body: { name: 'x' }, key: 'k' })
    assert.equal(none.res.status, 401)
    assert.equal(
      none.res.headers.get('www-authenticate'),
      'Bearer realm="Campaign Mailer"',
    )
    const wrong = await call('/campaigns', {
      secret: `cm_${'a'.repeat(43)}`,
      body: { name: 'x' },
    })
    assert.equal(wrong.res.status, 401)
    assert.equal(none.res.headers.get('set-cookie'), null)
  })

  it('creates a draft with its contacts, under the import rules', async () => {
    const { res, body } = await call('/campaigns', {
      secret: token,
      key: 'create-1',
      body: {
        name: 'Alternance 2027',
        type: 'alternance',
        contacts: [
          { email: 'RH@Acme.fr', contact_name: 'Marie Durand', company_name: 'Acme' },
          { email: 'rh@acme.fr' },
          { email: 'pas-une-adresse' },
        ],
      },
    })
    assert.equal(res.status, 201)
    const campaign = body.campaign as { id: string; status: string; url: string }
    assert.equal(campaign.status, 'draft')
    assert.ok(campaign.url.endsWith(`/campaigns/${campaign.id}`), campaign.url)
    assert.deepEqual(
      (
        body.report as { read: number; imported: number; rejected: { reason: string }[] }
      ).rejected.map((r) => r.reason),
      ['duplicate_in_file', 'invalid_email'],
    )

    const { rows } = await pool.query<{ email: string; source: string }>(
      'SELECT email, source FROM contacts WHERE campaign_id = $1',
      [campaign.id],
    )
    assert.deepEqual(rows, [{ email: 'rh@acme.fr', source: 'mailfind' }])
  })

  it('creates nothing twice under the same Idempotency-Key (A7)', async () => {
    const payload = { name: 'Relancée deux fois', contacts: [{ email: 'jobs@acme.fr' }] }
    const first = await call('/campaigns', { secret: token, key: 'twice', body: payload })
    const second = await call('/campaigns', {
      secret: token,
      key: 'twice',
      body: payload,
    })
    assert.equal(second.res.headers.get('idempotent-replayed'), 'true')
    assert.deepEqual(second.body, first.body)
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM campaigns WHERE user_id = $1 AND name = 'Relancée deux fois'",
      [userId],
    )
    assert.equal(rows[0]?.n, 1)

    const reused = await call('/campaigns', {
      secret: token,
      key: 'twice',
      body: { name: 'Autre' },
    })
    assert.equal(reused.res.status, 422)
  })

  it('requires the Idempotency-Key', async () => {
    const { res, body } = await call('/campaigns', {
      secret: token,
      body: { name: 'Sans clé' },
    })
    assert.equal(res.status, 400)
    assert.equal(body.code, 'idempotency_key_required')
  })

  it('adds contacts to a draft, skips those already there, and replays a batch sent again', async () => {
    const created = await call('/campaigns', {
      secret: token,
      key: 'add-base',
      body: { name: 'Base' },
    })
    const id = (created.body.campaign as { id: string }).id
    const batch = { contacts: [{ email: 'a@acme.fr' }, { email: 'b@acme.fr' }] }

    const first = await call(`/campaigns/${id}/contacts`, {
      secret: token,
      key: 'batch-1',
      body: batch,
    })
    assert.equal((first.body.report as { imported: number }).imported, 2)
    const again = await call(`/campaigns/${id}/contacts`, {
      secret: token,
      key: 'batch-1',
      body: batch,
    })
    assert.deepEqual(again.body, first.body)
    const overlap = await call(`/campaigns/${id}/contacts`, {
      secret: token,
      key: 'batch-2',
      body: { contacts: [{ email: 'b@acme.fr' }, { email: 'c@acme.fr' }] },
    })
    assert.equal((overlap.body.report as { imported: number }).imported, 1)

    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM contacts WHERE campaign_id = $1',
      [id],
    )
    assert.equal(rows[0]?.n, 3)
  })

  it('keeps another account out, and refuses a campaign no longer a draft', async () => {
    const created = await call('/campaigns', {
      secret: token,
      key: 'private',
      body: { name: 'Privée' },
    })
    const id = (created.body.campaign as { id: string }).id

    const foreign = await call(`/campaigns/${id}/contacts`, {
      secret: otherToken,
      key: 'intrude',
      body: { contacts: [{ email: 'x@acme.fr' }] },
    })
    assert.equal(foreign.res.status, 404)

    await pool.query("UPDATE campaigns SET status = 'running' WHERE id = $1", [id])
    const late = await call(`/campaigns/${id}/contacts`, {
      secret: token,
      key: 'late',
      body: { contacts: [{ email: 'x@acme.fr' }] },
    })
    assert.equal(late.res.status, 409)
    assert.equal(late.body.code, 'campaign_not_editable')
  })

  it('checks the scope of the token', async () => {
    const { res, body } = await call('/campaigns', {
      secret: readOnlyToken,
      key: 'scope',
      body: { name: 'Interdite' },
    })
    assert.equal(res.status, 403)
    assert.equal(body.code, 'insufficient_scope')
  })

  it('answers 404 on an unknown route, still behind the token', async () => {
    assert.equal((await call('/nothing', { method: 'GET' })).res.status, 401)
    assert.equal(
      (await call('/nothing', { method: 'GET', secret: token })).res.status,
      404,
    )
  })
})
