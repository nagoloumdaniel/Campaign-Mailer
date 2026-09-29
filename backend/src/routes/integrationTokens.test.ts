import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type {
  CreateTokenResult,
  IntegrationScope,
  IntegrationTokenRepository,
  IntegrationTokenRow,
} from '../services/integrationTokens.js'

import { createIntegrationTokenRouter } from './integrationTokens.js'

const USER = '11111111-1111-4111-8111-111111111111'
const TOKEN_ID = '22222222-2222-4222-8222-222222222222'

let signedIn: { id: string } | undefined
let limitReached = false
let revokable = true
const audited: string[] = []
const created: { name: string; scopes: IntegrationScope[] }[] = []

const row = (overrides: Partial<IntegrationTokenRow> = {}): IntegrationTokenRow => ({
  id: TOKEN_ID,
  name: 'MailFind',
  prefix: 'cm_abcdefgh',
  scopes: ['campaigns:write'],
  last_used_at: null,
  revoked_at: null,
  created_at: new Date('2026-09-30T08:00:00Z'),
  ...overrides,
})

const tokens: IntegrationTokenRepository = {
  create: (_userId, name, scopes): Promise<CreateTokenResult> => {
    created.push({ name, scopes })
    return Promise.resolve(
      limitReached
        ? { kind: 'limit_reached' }
        : {
            kind: 'created',
            token: row({ name, scopes }),
            secret: `cm_${'s'.repeat(43)}`,
          },
    )
  },
  list: () => Promise.resolve([row()]),
  revoke: () => Promise.resolve(revokable ? row({ revoked_at: new Date() }) : null),
  findActive: () => Promise.resolve(null),
  touch: () => Promise.resolve(),
}

let baseUrl: string
let server: Server

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedIn) req.user = signedIn
    next()
  })
  app.use(
    '/integration-tokens',
    createIntegrationTokenRouter({
      tokens,
      audit: {
        record: (actor, action) => {
          audited.push(`${action}:${actor}`)
          return Promise.resolve()
        },
      },
    }),
  )
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
})

beforeEach(() => {
  signedIn = { id: USER }
  limitReached = false
  revokable = true
  audited.length = 0
  created.length = 0
})

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/integration-tokens${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  })

describe('integration tokens from the account page', () => {
  it('refuses a request without a session', async () => {
    signedIn = undefined
    assert.equal((await call('')).status, 401)
  })

  it('lists the tokens with the cap, never a hash', async () => {
    const res = await call('')
    const body = (await res.json()) as { tokens: object[]; max_active: number }
    assert.equal(res.status, 200)
    assert.equal(body.max_active, 10)
    assert.equal(JSON.stringify(body).includes('hash'), false)
  })

  it('shows the secret once, uncached, and records the creation', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({
        name: '  MailFind ',
        scopes: ['campaigns:write', 'contacts:write'],
      }),
    })
    const body = (await res.json()) as { secret: string; token: { name: string } }
    assert.equal(res.status, 201)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(body.secret, /^cm_/)
    assert.deepEqual(created, [
      { name: 'MailFind', scopes: ['campaigns:write', 'contacts:write'] },
    ])
    assert.deepEqual(audited, [`integration_token.created:${USER}`])
  })

  it('refuses an empty name or an unknown scope', async () => {
    for (const body of [
      { name: ' ', scopes: ['campaigns:write'] },
      { name: 'MailFind', scopes: [] },
      { name: 'MailFind', scopes: ['campaigns:read'] },
    ]) {
      const res = await call('', { method: 'POST', body: JSON.stringify(body) })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    assert.equal(created.length, 0)
  })

  it('answers 409 past the cap of active tokens', async () => {
    limitReached = true
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ name: 'One more', scopes: ['campaigns:write'] }),
    })
    assert.equal(res.status, 409)
    assert.equal(audited.length, 0)
  })

  it('revokes a token of the account, and answers 404 otherwise', async () => {
    assert.equal((await call(`/${TOKEN_ID}`, { method: 'DELETE' })).status, 200)
    assert.deepEqual(audited, [`integration_token.revoked:${USER}`])
    revokable = false
    assert.equal((await call(`/${TOKEN_ID}`, { method: 'DELETE' })).status, 404)
    assert.equal((await call('/not-a-uuid', { method: 'DELETE' })).status, 404)
  })
})
