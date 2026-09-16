import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import { CURRENT_TERMS_VERSION } from '../services/terms.js'
import type { UserExport } from '../services/userExport.js'

import { createUsersRouter } from './users.js'

const ALICE = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'alice@exemple.fr' }

let signedIn: typeof ALICE | null
let deletedFor: string[]
let sessionDestroyed: boolean
let exportedFor: string[] = []
let exportMissing = false
let audited: string[] = []
let acceptedFor: string[] = []

const SAMPLE_EXPORT: UserExport = {
  exportedAt: '2026-09-14T10:00:00.000Z',
  account: {
    email: ALICE.email,
    googleAccountId: 'g-1',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  campaigns: [
    {
      id: 'c1',
      name: 'Candidatures',
      subject: 'Bonjour',
      bodyHtml: '<p>Bonjour</p>',
      bodyText: 'Bonjour',
      type: 'autre',
      attachmentNames: [],
      status: 'completed',
      mailsPerDay: 46,
      startHour: 9,
      pauseMs: 30000,
      timezone: 'Europe/Paris',
      createdAt: '2026-09-01T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
      contacts: [
        {
          email: 'rh@exemple.fr',
          contactName: 'Zoé',
          companyName: null,
          salutation: null,
          status: 'sent',
          errorMessage: null,
          attempts: 1,
          sentAt: '2026-09-02T09:00:00.000Z',
        },
      ],
      logs: [],
    },
  ],
}

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedIn) {
      req.user = signedIn
    }
    // Stand-ins for Passport and express-session, which the route drives.
    req.logout = ((done: (err?: unknown) => void) => {
      done()
    }) as typeof req.logout
    Object.assign(req, {
      session: {
        destroy: (done: (err?: unknown) => void) => {
          sessionDestroyed = true
          done()
        },
      },
    })
    next()
  })
  app.use(
    '/users',
    createUsersRouter({
      deleteAccount: (userId) => {
        deletedFor.push(userId)
        return Promise.resolve({ deleted: true, googleRevoked: true, filesPurged: false })
      },
      acceptTerms: (userId, version) => {
        acceptedFor.push(`${userId}:${version}`)
        return Promise.resolve()
      },
      audit: {
        record: (actor, action) => {
          audited.push(`${action}:${actor}`)
          return Promise.resolve()
        },
      },
      exportUser: (userId) => {
        exportedFor.push(userId)
        return Promise.resolve(exportMissing ? null : SAMPLE_EXPORT)
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
  signedIn = ALICE
  deletedFor = []
  sessionDestroyed = false
  exportedFor = []
  exportMissing = false
  audited = []
  acceptedFor = []
})

describe('POST /users/me/terms', () => {
  const accept = (body: unknown) =>
    fetch(`${baseUrl}/users/me/terms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('refuses a request without a session', async () => {
    signedIn = null
    assert.equal((await accept({ version: CURRENT_TERMS_VERSION })).status, 401)
    assert.deepEqual(acceptedFor, [])
  })

  it('records acceptance of the current version, and its proof in the audit log', async () => {
    const res = await accept({ version: CURRENT_TERMS_VERSION })

    assert.equal(res.status, 204)
    assert.deepEqual(acceptedFor, [`${ALICE.id}:${CURRENT_TERMS_VERSION}`])
    assert.deepEqual(audited, [`terms.accepted:${ALICE.id}`])
  })

  it('refuses a version that is not the current one, with 409', async () => {
    // A tab left open since the previous terms: consent to text never read.
    const res = await accept({ version: '2020-01-01' })

    assert.equal(res.status, 409)
    assert.deepEqual(acceptedFor, [])
    assert.deepEqual(audited, [])
  })

  it('refuses a body without a version', async () => {
    assert.equal((await accept({})).status, 400)
  })
})

describe('GET /users/me/export', () => {
  const get = (query = '') => fetch(`${baseUrl}/users/me/export${query}`)

  it('refuses a request without a session', async () => {
    signedIn = null

    assert.equal((await get()).status, 401)
    assert.deepEqual(exportedFor, [])
  })

  it('exports the signed-in user, never another', async () => {
    await get()
    assert.deepEqual(exportedFor, [ALICE.id])
  })

  it('downloads the complete record as JSON by default, uncached', async () => {
    const res = await get()

    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/)
    assert.equal(
      res.headers.get('content-disposition'),
      'attachment; filename="campaign-mailer-donnees-2026-09-14.json"',
    )
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), SAMPLE_EXPORT)
  })

  it('downloads the contacts as CSV when asked', async () => {
    const res = await get('?format=csv')

    assert.match(res.headers.get('content-type') ?? '', /^text\/csv/)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.ok((await res.text()).includes('"Candidatures","rh@exemple.fr","Zoé"'))
  })

  it('records the export in the audit log', async () => {
    await get()
    assert.deepEqual(audited, [`account.exported:${ALICE.id}`])
  })

  it('answers 404 when the account is gone', async () => {
    exportMissing = true
    assert.equal((await get()).status, 404)
  })
})

const remove = (body: unknown) =>
  fetch(`${baseUrl}/users/me`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('DELETE /users/me', () => {
  it('refuses a request without a session', async () => {
    signedIn = null

    assert.equal((await remove({ email: ALICE.email })).status, 401)
    assert.deepEqual(deletedFor, [])
  })

  it('refuses without the address typed again', async () => {
    assert.equal((await remove({})).status, 400)
    assert.deepEqual(deletedFor, [])
  })

  it('refuses an address that is not the signed-in account’s', async () => {
    const res = await remove({ email: 'bob@exemple.fr' })

    assert.equal(res.status, 422)
    assert.deepEqual(deletedFor, [])
  })

  it('deletes the signed-in account, whatever case the address was typed in', async () => {
    const res = await remove({ email: 'Alice@Exemple.FR' })

    assert.equal(res.status, 200)
    assert.deepEqual(deletedFor, [ALICE.id])
  })

  it('ends the session and clears the cookie', async () => {
    const res = await remove({ email: ALICE.email })

    assert.equal(sessionDestroyed, true)
    assert.match(res.headers.get('set-cookie') ?? '', /cm\.sid=;/)
  })

  it('says what could not be done, so the interface can tell the user', async () => {
    const body = (await (await remove({ email: ALICE.email })).json()) as Record<
      string,
      unknown
    >

    assert.deepEqual(body, { deleted: true, googleRevoked: true, filesPurged: false })
  })

  it('records the deletion in the audit log', async () => {
    await remove({ email: ALICE.email })
    assert.deepEqual(audited, [`account.deleted:${ALICE.id}`])
  })

  it('records nothing when the address does not match', async () => {
    await remove({ email: 'bob@exemple.fr' })
    assert.deepEqual(audited, [])
  })

  it('refuses an unknown field', async () => {
    assert.equal((await remove({ email: ALICE.email, force: true })).status, 400)
  })
})
