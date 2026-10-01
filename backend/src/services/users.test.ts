import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toPublicUser, type UserRow } from './users.js'

const row = {
  id: 'user-uuid',
  email: 'person@example.com',
  google_id: 'google-123',
  created_at: new Date('2026-09-11T10:00:00Z'),
  updated_at: new Date('2026-09-11T11:00:00Z'),
  // Columns the row type does not name but the table carries. A SELECT * would
  // bring them along, so the mapper is what stands between them and a client.
  google_access_token: 'v1.aaa.bbb.ccc',
  google_refresh_token: 'v1.ddd.eee.fff',
} as unknown as UserRow

describe('toPublicUser', () => {
  it('returns the id, the email and the creation date', () => {
    assert.deepEqual(toPublicUser(row), {
      id: 'user-uuid',
      email: 'person@example.com',
      createdAt: '2026-09-11T10:00:00.000Z',
      termsVersion: null,
      gmailConnected: false,
    })
  })

  it('says whether Gmail sending is granted, as a flag and nothing more', () => {
    const connected = { ...row, gmail_connected: true } as UserRow

    assert.equal(toPublicUser(connected).gmailConnected, true)
  })

  it('lets no token through, whatever the row carries', () => {
    const serialized = JSON.stringify(toPublicUser(row))

    assert.ok(!serialized.includes('v1.aaa'))
    assert.ok(!serialized.includes('v1.ddd'))
    assert.ok(!/token/i.test(serialized))
  })

  it('lets no Google id through', () => {
    // The Google id identifies the account at Google. It has no use in a
    // client and every use to someone enumerating accounts.
    assert.ok(!JSON.stringify(toPublicUser(row)).includes('google-123'))
  })
})
