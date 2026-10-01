import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createUserRepository, type UserRepository } from './users.js'

/**
 * The user repository against a real PostgreSQL.
 *
 * What matters most here is one line of SQL: Google sends a refresh token only
 * on the first authorization, so a later sign-in must keep the stored one. A
 * fake cannot prove an upsert does that; the database can.
 *
 * Skipped when DATABASE_URL is absent. Rows are removed by their exact Google
 * id, not by a shared prefix, so a file running beside this one keeps its own.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const googleId = `itest-users-${String(Date.now())}-${String(process.pid)}`
const expiry = new Date('2030-01-01T00:00:00Z')

let pool: pg.Pool
let users: UserRepository
let userId: string

before(() => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  users = createUserRepository(pool)
})

after(async () => {
  if (!enabled) {
    return
  }

  await pool.query('DELETE FROM users WHERE google_id = $1', [googleId])
  await pool.end()
})

async function storedAuth() {
  const auth = await users.findAuthById(userId)
  assert.ok(auth, 'the account has no auth row')
  return auth
}

describe(
  'the user repository',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('creates the account on the first sign-in, with its tokens', async () => {
      const row = await users.upsertFromGoogle({
        googleId,
        email: `${googleId}@example.test`,
        accessToken: 'enc-access-1',
        refreshToken: 'enc-refresh-1',
        accessTokenExpiresAt: expiry,
      })
      userId = row.id

      assert.equal(row.google_id, googleId)
      assert.equal(row.terms_version, null)

      const auth = await storedAuth()
      assert.equal(auth.google_access_token, 'enc-access-1')
      assert.equal(auth.google_refresh_token, 'enc-refresh-1')
      assert.equal(auth.google_token_expires_at?.toISOString(), expiry.toISOString())
    })

    it('keeps the stored refresh token when a later sign-in brings none', async () => {
      const row = await users.upsertFromGoogle({
        googleId,
        email: `renamed-${googleId}@example.test`,
        accessToken: 'enc-access-2',
      })

      assert.equal(row.id, userId, 'a second sign-in created a second account')
      assert.equal(row.email, `renamed-${googleId}@example.test`)

      const auth = await storedAuth()
      assert.equal(auth.google_access_token, 'enc-access-2')
      assert.equal(auth.google_refresh_token, 'enc-refresh-1')
      assert.equal(auth.google_token_expires_at?.toISOString(), expiry.toISOString())
    })

    it('replaces the refresh token when Google sends a new one', async () => {
      await users.upsertFromGoogle({
        googleId,
        email: `${googleId}@example.test`,
        accessToken: 'enc-access-3',
        refreshToken: 'enc-refresh-2',
      })

      assert.equal((await storedAuth()).google_refresh_token, 'enc-refresh-2')
    })

    it('saves a renewed access token without touching the refresh token', async () => {
      const renewedExpiry = new Date('2031-06-01T12:00:00Z')
      await users.saveAccessToken(userId, 'enc-access-renewed', renewedExpiry)

      const auth = await storedAuth()
      assert.equal(auth.google_access_token, 'enc-access-renewed')
      assert.equal(auth.google_refresh_token, 'enc-refresh-2')
      assert.equal(
        auth.google_token_expires_at?.toISOString(),
        renewedExpiry.toISOString(),
      )
    })

    it('finds the account by id, and nothing for an id that does not exist', async () => {
      const missing = '00000000-0000-4000-8000-000000000000'

      assert.equal((await users.findById(userId))?.google_id, googleId)
      assert.equal(await users.findById(missing), null)
      assert.equal(await users.findAuthById(missing), null)
    })

    it('never returns a token column from the account lookup', async () => {
      const row = await users.findById(userId)

      assert.ok(row)
      // gmail_connected is derived in SQL, a boolean, never the token itself.
      assert.equal(typeof row.gmail_connected, 'boolean')
      assert.deepEqual(Object.keys(row).sort(), [
        'created_at',
        'email',
        'gmail_connected',
        'google_id',
        'id',
        'terms_version',
        'updated_at',
      ])
    })
  },
)
