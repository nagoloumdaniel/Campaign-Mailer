import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import type { ContactCounts, SendWindow, StatsRepository } from '../services/stats.js'

import { createStatsRouter } from './stats.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'

let campaign: CampaignRow
let counts: ContactCounts
let window: SendWindow
let signedInAs: string | null
let askedZone: string | null

function baseCampaign(): CampaignRow {
  return {
    id: CAMPAIGN,
    user_id: ALICE,
    name: 'Candidatures',
    subject: 'Candidature',
    body_html: '<p>Bonjour</p>',
    body_text: 'Bonjour',
    type: 'autre',
    status: 'running',
    total_contacts: 10,
    sent_count: 0,
    error_count: 0,
    mails_per_day: 46,
    start_hour: 9,
    pause_ms: 30_000,
    timezone: 'Europe/Paris',
    created_at: new Date('2026-06-30T10:00:00Z'),
    updated_at: new Date('2026-06-30T10:00:00Z'),
    scheduled_at: null,
    send_after: null,
    started_at: null,
    completed_at: null,
  }
}

const campaigns = {
  findForUser: (id: string, userId: string) =>
    Promise.resolve(id === campaign.id && userId === campaign.user_id ? campaign : null),
} as unknown as CampaignRepository

const stats: StatsRepository = {
  accountSendsPerDay: () => Promise.resolve([]),
  contactCounts: () => Promise.resolve(counts),
  sendWindow: () => Promise.resolve(window),
  sendsPerDay: (_id, zone) => {
    askedZone = zone
    return Promise.resolve([{ day: '2026-07-01', sent: 6, failed: 1 }])
  },
}

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use(
    '/campaigns/:id/stats',
    createStatsRouter({ campaigns, stats, now: () => new Date('2026-07-01T10:00:00Z') }),
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
  campaign = baseCampaign()
  counts = { total: 10, sent: 6, failed: 1, pending: 2, ignored: 1 }
  window = {
    sentLast24h: 6,
    oldestInWindowAt: new Date('2026-07-01T07:00:00Z'),
    lastSentAt: new Date('2026-07-01T09:59:50Z'),
    nextPlannedAt: null,
  }
  signedInAs = ALICE
  askedZone = null
})

interface StatsBody {
  stats: {
    total: number
    sent: number
    failed: number
    pending: number
    ignored: number
    errorRate: number | null
    lastSentAt: string | null
    nextSendAt: string | null
    estimatedEndAt: string | null
    perDay: { day: string; sent: number; failed: number }[]
  }
}

const get = async (id = CAMPAIGN) => {
  const res = await fetch(`${baseUrl}/campaigns/${id}/stats`)
  return { status: res.status, body: (await res.json()) as StatsBody }
}

describe('GET /campaigns/:id/stats', () => {
  it('refuses a request without a session', async () => {
    signedInAs = null
    assert.equal((await get()).status, 401)
  })

  it('answers 404 for another user’s campaign', async () => {
    signedInAs = 'bbbbbbbb-2222-4222-8222-222222222222'
    assert.equal((await get()).status, 404)
  })

  it('answers 404 for a malformed id', async () => {
    assert.equal((await get('pas-un-uuid')).status, 404)
  })

  it('returns every count the dashboard needs', async () => {
    const { status, body } = await get()

    assert.equal(status, 200)
    assert.equal(body.stats.total, 10)
    assert.equal(body.stats.sent, 6)
    assert.equal(body.stats.failed, 1)
    assert.equal(body.stats.pending, 2)
    assert.equal(body.stats.ignored, 1)
  })

  it('computes the error rate over the sends attempted', async () => {
    const { body } = await get()
    assert.equal(body.stats.errorRate, 1 / 7)
  })

  it('has no error rate before anything was attempted', async () => {
    counts = { total: 3, sent: 0, failed: 0, pending: 3, ignored: 0 }
    assert.equal((await get()).body.stats.errorRate, null)
  })

  it('estimates the next send from the last one and the pause', async () => {
    const { body } = await get()

    assert.equal(body.stats.nextSendAt, '2026-07-01T10:00:20.000Z')
    assert.ok(body.stats.estimatedEndAt)
    assert.ok(body.stats.estimatedEndAt > body.stats.nextSendAt)
  })

  it('gives the queued send’s own time once the planner has written it', async () => {
    // The jitter put it at 10:00:23, not at the 10:00:20 the rules predict.
    window = { ...window, nextPlannedAt: new Date('2026-07-01T10:00:23Z') }

    assert.equal((await get()).body.stats.nextSendAt, '2026-07-01T10:00:23.000Z')
  })

  it('estimates nothing for a campaign that is not sending', async () => {
    campaign = { ...baseCampaign(), status: 'paused' }

    const { body } = await get()
    assert.equal(body.stats.nextSendAt, null)
    assert.equal(body.stats.estimatedEndAt, null)
  })

  it('groups the days in the campaign’s own time zone', async () => {
    const { body } = await get()

    assert.equal(askedZone, 'Europe/Paris')
    assert.deepEqual(body.stats.perDay, [{ day: '2026-07-01', sent: 6, failed: 1 }])
  })
})
