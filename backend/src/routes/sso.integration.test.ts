import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import session from 'express-session'
import pg from 'pg'

/**
 * Sign in with MailFind, both ways (MailFind decision D-26), over HTTP against
 * a real PostgreSQL and the real application. A small server stands in for
 * MailFind: it answers the code exchange the way MailFind's /api/sso/token
 * does, so the real fetch, the secret and the parsing are all exercised.
 *
 * Run it on a throwaway schema: `npm run test:integration`. Skipped without
 * DATABASE_URL or the rest of the backend configuration.
 */
const SECRET = 'shared-secret-for-the-integration-test-0123'
const stamp = `sso-itest-${String(Date.now())}-${String(process.pid)}`

/** What the fake MailFind vouches for on the next exchange. */
let identity: { google_id: string; email: string; name: string | null }
const exchanged: string[] = []

const fakeMailfind: Server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk: Buffer) => {
    raw += chunk.toString()
  })
  req.on('end', () => {
    if (
      req.url !== '/api/sso/token' ||
      req.headers.authorization !== `Bearer ${SECRET}`
    ) {
      res.writeHead(401).end()
      return
    }
    exchanged.push((JSON.parse(raw) as { code: string }).code)
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(identity))
  })
})

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL) {
  await new Promise<void>((resolve) => {
    fakeMailfind.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  process.env.MAILFIND_URL = `http://127.0.0.1:${String((fakeMailfind.address() as AddressInfo).port)}`
  process.env.MAILFIND_SSO_SECRET = SECRET
}

const loaded = DATABASE_URL ? await import('../app.js').catch(() => null) : null

let pool: pg.Pool
let server: Server
let baseUrl: string

/** The one cookie a response sets under a name, as a Cookie header value. */
function cookieFrom(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(';')[0] ?? '')
    .find((pair) => pair.startsWith(`${name}=`))
}

const get = (path: string, cookie?: string) =>
  fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })

/** Walks the MailFind round trip and returns where it lands and the session. */
async function signInThroughMailfind(stateOverride?: string) {
  const start = await get('/api/auth/mailfind')
  assert.equal(start.status, 302)
  const target = new URL(start.headers.get('location') ?? '')
  assert.equal(
    `${target.origin}${target.pathname}`,
    `${process.env.MAILFIND_URL ?? ''}/api/sso/authorize`,
  )
  const state = stateOverride ?? target.searchParams.get('state') ?? ''
  const first = cookieFrom(start, 'cm.sid')
  assert.ok(first, 'the state needs a session')

  const back = await get(
    `/api/auth/mailfind/callback?code=${'c'.repeat(43)}&state=${state}`,
    first,
  )
  return {
    location: back.headers.get('location') ?? '',
    cookie: cookieFrom(back, 'cm.sid'),
  }
}

async function me(cookie: string | undefined) {
  const res = await get('/api/auth/me', cookie)
  return res.status === 200
    ? ((await res.json()) as { user: Record<string, unknown> }).user
    : null
}

describe('sign in with MailFind, both ways', { skip: !loaded }, () => {
  before(async () => {
    assert.ok(loaded)
    pool = new pg.Pool({ connectionString: DATABASE_URL })
    const app = loaded.createApp({ sessionStore: new session.MemoryStore() })
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
    await new Promise<void>((resolve) => {
      fakeMailfind.close(() => {
        resolve()
      })
    })
    await pool.query(`DELETE FROM users WHERE google_id LIKE $1`, [`${stamp}%`])
    await pool.end()
  })

  it('creates the account when there is none, without Gmail access', async () => {
    identity = {
      google_id: `${stamp}-new`,
      email: `New-${stamp}@Example.test`,
      name: 'Ignored',
    }

    const { location, cookie } = await signInThroughMailfind()

    assert.equal(location, 'http://localhost:5173')
    assert.equal(exchanged.at(-1), 'c'.repeat(43))
    const user = await me(cookie)
    assert.ok(user)
    assert.equal(user.email, `new-${stamp}@example.test`)
    assert.equal(user.gmailConnected, false)
    assert.equal(user.termsVersion, null)
  })

  it('finds the existing Google account by its id, with no duplicate', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (google_id, email, google_access_token, google_refresh_token)
       VALUES ($1, $2, 'cipher-a', 'cipher-r') RETURNING id`,
      [`${stamp}-existing`, `existing-${stamp}@example.test`],
    )
    identity = {
      google_id: `${stamp}-existing`,
      email: `existing-${stamp}@example.test`,
      name: null,
    }

    const { cookie } = await signInThroughMailfind()

    const user = await me(cookie)
    assert.equal(user?.id, rows[0]?.id)
    assert.equal(user?.gmailConnected, true)
    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM users WHERE lower(email) = $1`,
      [`existing-${stamp}@example.test`],
    )
    assert.equal(count.rows[0]?.n, '1')
    const tokens = await pool.query<{ google_refresh_token: string }>(
      'SELECT google_refresh_token FROM users WHERE id = $1',
      [rows[0]?.id],
    )
    assert.equal(
      tokens.rows[0]?.google_refresh_token,
      'cipher-r',
      'the Gmail grant survives',
    )
  })

  it('refuses an address another Google account holds', async () => {
    await pool.query(`INSERT INTO users (google_id, email) VALUES ($1, $2)`, [
      `${stamp}-owner`,
      `taken-${stamp}@example.test`,
    ])
    identity = {
      google_id: `${stamp}-intruder`,
      email: `taken-${stamp}@example.test`,
      name: null,
    }

    const { location, cookie } = await signInThroughMailfind()

    assert.equal(location, 'http://localhost:5173/login?error=mailfind-conflict')
    assert.equal(await me(cookie), null)
  })

  it('refuses a return whose state does not match', async () => {
    const before = exchanged.length

    const { location } = await signInThroughMailfind('a-state-this-browser-never-had')

    assert.equal(location, 'http://localhost:5173/login?error=mailfind')
    assert.equal(exchanged.length, before, 'no code is exchanged on a forged return')
  })

  it('issues MailFind a one-time code for a signed-in account', async () => {
    identity = {
      google_id: `${stamp}-provider`,
      email: `provider-${stamp}@example.test`,
      name: null,
    }
    const { cookie } = await signInThroughMailfind()
    const state = 'state-from-mailfind-0123456789'

    const authorize = await get(`/api/sso/authorize?state=${state}`, cookie)

    assert.equal(authorize.status, 302)
    const back = new URL(authorize.headers.get('location') ?? '')
    assert.equal(
      `${back.origin}${back.pathname}`,
      `${process.env.MAILFIND_URL ?? ''}/api/auth/campaign-mailer/callback`,
    )
    assert.equal(back.searchParams.get('state'), state)
    const code = back.searchParams.get('code') ?? ''

    const trade = (secret: string) =>
      fetch(`${baseUrl}/api/sso/token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })

    assert.equal((await trade('x'.repeat(48))).status, 401)
    const first = await trade(SECRET)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await first.json(), {
      google_id: `${stamp}-provider`,
      email: `provider-${stamp}@example.test`,
      name: null,
    })
    const replay = await trade(SECRET)
    assert.equal(replay.status, 400)
    assert.deepEqual(await replay.json(), {
      error: 'Code refused',
      code: 'invalid_grant',
    })
  })

  it('sends a signed-out person through Google first, and remembers why', async () => {
    const state = 'state-from-mailfind-0123456789'

    const res = await get(`/api/sso/authorize?state=${state}`)

    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/api/auth/google')
    const pending = res.headers.getSetCookie().find((line) => line.startsWith('cm.sso='))
    assert.ok(pending)
    assert.ok(pending.includes(state))
    assert.ok(pending.includes('HttpOnly'))
  })

  it('refuses a malformed state without redirecting', async () => {
    const res = await get('/api/sso/authorize?state=short')

    assert.equal(res.status, 400)
  })
})
