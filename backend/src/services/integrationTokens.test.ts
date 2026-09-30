import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  generateToken,
  hashToken,
  INTEGRATION_SCOPES,
  looksLikeToken,
} from './integrationTokens.js'

describe('generateToken', () => {
  it('gives a secret, its display prefix and its hash, never twice the same', () => {
    const one = generateToken()
    const other = generateToken()

    assert.match(one.secret, /^cm_[A-Za-z0-9_-]{43}$/)
    assert.equal(one.prefix, one.secret.slice(0, 11))
    assert.equal(one.hash, hashToken(one.secret))
    assert.match(one.hash, /^[0-9a-f]{64}$/)
    assert.notEqual(one.secret, other.secret)
  })

  it('keeps the secret out of its hash', () => {
    const { secret, hash } = generateToken()
    assert.equal(hash.includes(secret.slice(3, 20)), false)
  })
})

describe('looksLikeToken', () => {
  it('recognises the shape of a token without a query', () => {
    assert.equal(looksLikeToken(generateToken().secret), true)
    assert.equal(looksLikeToken('cm_short'), false)
    assert.equal(looksLikeToken(`mf_${'a'.repeat(43)}`), false)
  })
})

describe('INTEGRATION_SCOPES', () => {
  it('holds the two scopes of the roadmap', () => {
    assert.deepEqual([...INTEGRATION_SCOPES], ['campaigns:write', 'contacts:write'])
  })
})
