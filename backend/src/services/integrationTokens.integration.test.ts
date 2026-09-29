import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  createIntegrationTokenRepository,
  hashToken,
  MAX_ACTIVE_TOKENS,
  type IntegrationTokenRepository,
} from './integrationTokens.js'

/**
 * Integration tokens against a real PostgreSQL: the cap held under concurrent
 * creations, the owner check in every statement, the lookup by hash.
 *
 * Skipped when DATABASE_URL is absent. Rows are removed by their exact Google
 * id, so a file running beside this one keeps its own.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const stamp = `${String(Date.now())}-${String(process.pid)}`
const googleIds = [`itest-tokens-${stamp}`, `itest-tokens-other-${stamp}`]

let pool: pg.Pool
let tokens: IntegrationTokenRepository
let userId: string
let otherId: string

async function createUser(googleId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [googleId, `${googleId}@example.test`],
  )
  const id = rows[0]?.id
  assert.ok(id)
  return id
}

describe('the integration token repository', { skip: !enabled }, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL })
    tokens = createIntegrationTokenRepository(pool)
    userId = await createUser(googleIds[0] ?? '')
    otherId = await createUser(googleIds[1] ?? '')
  })

  after(async () => {
    await pool.query('DELETE FROM users WHERE google_id = ANY($1::text[])', [googleIds])
    await pool.end()
  })

  it('keeps only the hash, and finds the token by it', async () => {
    const result = await tokens.create(userId, 'MailFind', ['campaigns:write'])
    assert.equal(result.kind, 'created')

    const { rows } = await pool.query<{ line: string }>(
      'SELECT row_to_json(t)::text AS line FROM integration_tokens t WHERE id = $1',
      [result.token.id],
    )
    assert.equal(rows[0]?.line.includes(result.secret.slice(11)), false)
    assert.deepEqual(await tokens.findActive(hashToken(result.secret)), {
      id: result.token.id,
      userId,
      scopes: ['campaigns:write'],
    })
  })

  it('stops at the cap, even under concurrent creations', async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_ACTIVE_TOKENS + 4 }, (_, i) =>
        tokens.create(otherId, `token ${String(i)}`, ['contacts:write']),
      ),
    )
    assert.equal(results.filter((r) => r.kind === 'created').length, MAX_ACTIVE_TOKENS)
  })

  it('revokes once, only for its owner, and a revoked token is not found', async () => {
    const result = await tokens.create(userId, 'To revoke', ['campaigns:write'])
    assert.equal(result.kind, 'created')

    assert.equal(await tokens.revoke(otherId, result.token.id), null)
    assert.ok(await tokens.revoke(userId, result.token.id))
    assert.equal(await tokens.revoke(userId, result.token.id), null)
    assert.equal(await tokens.findActive(hashToken(result.secret)), null)
  })

  it('writes the last-used date at most once a minute', async () => {
    const result = await tokens.create(userId, 'Touched', ['campaigns:write'])
    assert.equal(result.kind, 'created')

    await tokens.touch(result.token.id)
    const first = await pool.query<{ t: Date }>(
      'SELECT last_used_at AS t FROM integration_tokens WHERE id = $1',
      [result.token.id],
    )
    await tokens.touch(result.token.id)
    const second = await pool.query<{ t: Date }>(
      'SELECT last_used_at AS t FROM integration_tokens WHERE id = $1',
      [result.token.id],
    )
    assert.ok(first.rows[0]?.t)
    assert.deepEqual(second.rows[0]?.t, first.rows[0].t)
  })

  it('goes with the account', async () => {
    const lone = await createUser(`itest-tokens-lone-${stamp}`)
    await tokens.create(lone, 'Lone', ['campaigns:write'])
    await pool.query('DELETE FROM users WHERE id = $1', [lone])
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM integration_tokens WHERE user_id = $1',
      [lone],
    )
    assert.equal(rows[0]?.n, 0)
  })
})
