import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignStatus } from '../services/campaignState.js'
import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import type { StatsRepository } from '../services/stats.js'

import { createDashboardRouter } from './dashboard.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'

let rows: CampaignRow[]
let accountSent: number
let signedInAs: string | null
let listedFor: string | null

function campaign(
  id: string,
  status: CampaignStatus,
  extra: Partial<CampaignRow> = {},
): CampaignRow {
  return {
    id,
    user_id: ALICE,
    name: `Campagne ${id}`,
    subject: 'Objet',
    body_html: '<p>Corps</p>',
    body_text: 'Corps',
    type: 'autre',
    status,
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
    started_at: null,
    completed_at: null,
    ...extra,
  }
}

const campaigns = {
  listForUser: (userId: string) => {
    listedFor = userId
    return Promise.resolve(rows)
  },
  accountSentLast24h: () => Promise.resolve(accountSent),
} as unknown as CampaignRepository

let askedZone: string | null = null

const stats: StatsRepository = {
  contactCounts: (id) =>
    Promise.resolve({
      total: 10,
      sent: 0,
      failed: 0,
      pending: id === 'done' ? 0 : 4,
      ignored: 0,
    }),
  sendWindow: (id) =>
    Promise.resolve({
      sentLast24h: 1,
      oldestInWindowAt: new Date('2026-07-01T09:00:00Z'),
      // "late" sent a moment ago, so its next send is further off than "soon".
      lastSentAt: new Date(
        id === 'late' ? '2026-07-01T09:59:59Z' : '2026-07-01T09:00:00Z',
      ),
      nextPlannedAt: null,
    }),
  sendsPerDay: () => Promise.resolve([]),
  accountSendsPerDay: (_userId, timezone) => {
    askedZone = timezone
    return Promise.resolve([
      { day: '2026-06-30', sent: 3 },
      { day: '2026-07-01', sent: 5 },
    ])
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
    '/dashboard',
    createDashboardRouter({
      campaigns,
      stats,
      accountDailyLimit: 450,
      now: () => new Date('2026-07-01T10:00:00Z'),
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
  askedZone = null
  rows = []
  accountSent = 0
  signedInAs = ALICE
  listedFor = null
})

interface DashboardBody {
  dashboard: {
    campaigns: { total: number; byStatus: Record<CampaignStatus, number> }
    account: { sentLast24h: number; dailyLimit: number; remaining: number }
    upcoming: {
      campaignId: string
      name: string
      pending: number
      nextSendAt: string | null
      estimatedEndAt: string | null
    }[]
  }
}

const get = async () => {
  const res = await fetch(`${baseUrl}/dashboard`)
  return { status: res.status, body: (await res.json()) as DashboardBody }
}

describe('GET /dashboard', () => {
  it('refuses a request without a session', async () => {
    signedInAs = null
    assert.equal((await get()).status, 401)
  })

  it('reads only the signed-in user’s campaigns', async () => {
    await get()
    assert.equal(listedFor, ALICE)
  })

  it('answers an empty account with zeros, not a missing field', async () => {
    const { status, body } = await get()

    assert.equal(status, 200)
    assert.equal(body.dashboard.campaigns.total, 0)
    assert.deepEqual(body.dashboard.campaigns.byStatus, {
      draft: 0,
      scheduled: 0,
      running: 0,
      paused: 0,
      completed: 0,
    })
    assert.deepEqual(body.dashboard.upcoming, [])
    assert.equal(body.dashboard.account.remaining, 450)
  })

  it('counts campaigns by status', async () => {
    rows = [
      campaign('a', 'draft'),
      campaign('b', 'running'),
      campaign('c', 'running'),
      campaign('d', 'completed'),
    ]

    const { body } = await get()
    assert.equal(body.dashboard.campaigns.total, 4)
    assert.equal(body.dashboard.campaigns.byStatus.running, 2)
    assert.equal(body.dashboard.campaigns.byStatus.draft, 1)
  })

  it('reports what is left of the account’s ceiling, never below zero', async () => {
    accountSent = 120
    assert.equal((await get()).body.dashboard.account.remaining, 330)

    accountSent = 460
    assert.equal((await get()).body.dashboard.account.remaining, 0)
  })

  it('lists only sending campaigns as upcoming, soonest first', async () => {
    rows = [
      campaign('late', 'running'),
      campaign('draft', 'draft'),
      campaign('soon', 'scheduled'),
      campaign('paused', 'paused'),
    ]

    const { body } = await get()
    assert.deepEqual(
      body.dashboard.upcoming.map((item) => item.campaignId),
      ['soon', 'late'],
    )
    assert.equal(body.dashboard.upcoming[0]?.pending, 4)
  })

  it('puts a sending campaign with nobody left to send to last', async () => {
    rows = [campaign('done', 'running'), campaign('soon', 'running')]

    const { body } = await get()
    assert.deepEqual(
      body.dashboard.upcoming.map((item) => [item.campaignId, item.nextSendAt === null]),
      [
        ['soon', false],
        ['done', true],
      ],
    )
  })
})

describe('the account sparkline', () => {
  it('returns the account’s sends per day, in the zone asked for', async () => {
    const response = await fetch(`${baseUrl}/dashboard?timezone=America/New_York`)
    const body = (await response.json()) as {
      dashboard: { account: { perDay: { day: string; sent: number }[] } }
    }

    assert.equal(response.status, 200)
    assert.equal(askedZone, 'America/New_York')
    assert.deepEqual(
      body.dashboard.account.perDay.map((day) => day.sent),
      [3, 5],
    )
  })

  it('reads the calendar in Paris when no zone is given', async () => {
    await fetch(`${baseUrl}/dashboard`)
    assert.equal(askedZone, 'Europe/Paris')
  })

  it('refuses a fixed offset, which PostgreSQL would read differently', async () => {
    const response = await fetch(`${baseUrl}/dashboard?timezone=%2B02%3A00`)
    assert.equal(response.status, 400)
  })
})
