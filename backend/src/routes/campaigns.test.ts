import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignStatus } from '../services/campaignState.js'
import type {
  CampaignAttachmentRow,
  CampaignPatch,
  CampaignRepository,
  CampaignRow,
} from '../services/campaigns.js'

import { createCampaignRouter } from './campaigns.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'
const CONTACT = 'dddddddd-4444-4444-8444-444444444444'

/** `exactOptionalPropertyTypes` is on, so an absent key has to allow undefined. */
type RowOverrides = { [K in keyof CampaignRow]?: CampaignRow[K] | undefined }

function row(overrides: RowOverrides = {}): CampaignRow {
  // Spreading would let an explicitly-undefined override erase a default,
  // which is exactly what exactOptionalPropertyTypes objects to. Only defined
  // values are applied.
  const merged: CampaignRow = defaults()

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      Object.assign(merged, { [key]: value })
    }
  }

  return merged
}

function defaults(): CampaignRow {
  return {
    id: CAMPAIGN,
    user_id: ALICE,
    name: 'Candidatures',
    type: 'autre',
    subject: null,
    body_html: null,
    body_text: null,
    status: 'draft',
    total_contacts: 0,
    sent_count: 0,
    error_count: 0,
    mails_per_day: 46,
    start_hour: 9,
    pause_ms: 3000,
    timezone: 'Europe/Paris',
    created_at: new Date('2026-09-12T10:00:00Z'),
    updated_at: new Date('2026-09-12T10:00:00Z'),
    scheduled_at: null,
    started_at: null,
    completed_at: null,
  }
}

let stored: CampaignRow | null = row()
let signedInAs: string | null = ALICE
let lastPatch: CampaignPatch | null = null
let removed = false
let pendingContacts = 3
let accountSent = 0
let dispatched: string[] = []
let dispatchFails = false
/** Simulates another request moving the campaign between the read and the update. */
let raceLost = false
let audited: string[] = []
let attachments: CampaignAttachmentRow[] = []
let followUpImported = 2
let followedUp: {
  userId: string
  name: string
  type: string
  contactIds: readonly string[]
} | null = null

const repository: CampaignRepository = {
  belongsTo: () => Promise.resolve(true),
  listForUser: (userId) => Promise.resolve(stored?.user_id === userId ? [stored] : []),
  create: (userId, input) => Promise.resolve(row({ user_id: userId, ...input })),
  findForUser: (campaignId, userId) =>
    Promise.resolve(
      stored?.id === campaignId && stored.user_id === userId ? stored : null,
    ),
  update: (_campaignId, patch) => {
    lastPatch = patch
    return Promise.resolve(stored ? row({ ...stored, ...patch }) : null)
  },
  remove: () => {
    removed = true
    return Promise.resolve(true)
  },
  transition: (_campaignId, from, to) => {
    if (raceLost || !stored || !from.includes(stored.status)) {
      return Promise.resolve(null)
    }
    stored = row({ ...stored, status: to })
    return Promise.resolve(stored)
  },
  countPendingContacts: () => Promise.resolve(pendingContacts),
  accountSentLast24h: () => Promise.resolve(accountSent),
  listAttachments: () => Promise.resolve(attachments),
  findAttachment: (_campaignId, attachmentId) =>
    Promise.resolve(attachments.find((file) => file.id === attachmentId) ?? null),
  addAttachment: () => Promise.resolve(attachments[0] ?? null),
  removeAttachment: () => Promise.resolve(true),
  createFollowUp: (userId, input) => {
    followedUp = { userId, ...input }
    return Promise.resolve({
      campaign: row({ name: input.name, type: input.type }),
      imported: followUpImported,
    })
  },
  findContact: (campaignId, contactId) =>
    Promise.resolve(
      campaignId === CAMPAIGN && contactId === CONTACT
        ? {
            id: CONTACT,
            email: 'marie@exemple.fr',
            contact_name: 'Marie',
            company_name: 'Acme',
            salutation: 'Madame',
          }
        : null,
    ),
}

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use(
    '/campaigns',
    createCampaignRouter(repository, {
      accountDailyLimit: 450,
      audit: {
        record: (_actor, action, target) => {
          audited.push(`${action}:${String(target)}`)
          return Promise.resolve()
        },
      },
      requestDispatch: (campaignId) => {
        if (dispatchFails) {
          return Promise.reject(new Error('Redis unreachable'))
        }
        dispatched.push(campaignId)
        return Promise.resolve()
      },
    }),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

beforeEach(() => {
  stored = row()
  signedInAs = ALICE
  lastPatch = null
  removed = false
  pendingContacts = 3
  accountSent = 0
  dispatched = []
  dispatchFails = false
  raceLost = false
  audited = []
  attachments = []
  followUpImported = 2
  followedUp = null
})

describe('a follow-up campaign', () => {
  const CONTACT_A = '11111111-1111-4111-8111-111111111111'
  const CONTACT_B = '22222222-2222-4222-8222-222222222222'

  it('copies the selected contacts and files the campaign under relance', async () => {
    const response = await send('/campaigns/follow-up', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Relance septembre',
        contact_ids: [CONTACT_A, CONTACT_B],
      }),
    })

    assert.equal(response.status, 201)

    const body = (await response.json()) as {
      campaign: { name: string; type: string }
      imported: number
    }

    assert.equal(body.campaign.type, 'relance')
    assert.equal(body.imported, 2)
    assert.ok(followedUp, 'the repository should have been asked to copy the contacts')
    assert.deepEqual(followedUp.contactIds, [CONTACT_A, CONTACT_B])
    assert.equal(followedUp.userId, ALICE)
  })

  it('refuses a selection that copied nothing, and leaves no empty campaign behind', async () => {
    followUpImported = 0

    const response = await send('/campaigns/follow-up', {
      method: 'POST',
      body: JSON.stringify({ name: 'Relance', contact_ids: [CONTACT_A] }),
    })

    assert.equal(response.status, 404)
    assert.equal(removed, true)
  })

  it('refuses an empty selection', async () => {
    const response = await send('/campaigns/follow-up', {
      method: 'POST',
      body: JSON.stringify({ name: 'Relance', contact_ids: [] }),
    })

    assert.equal(response.status, 400)
  })
})

const send = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

describe('without a session', () => {
  it('refuses every route', async () => {
    signedInAs = null

    for (const [method, path] of [
      ['GET', '/campaigns'],
      ['POST', '/campaigns'],
      ['GET', `/campaigns/${CAMPAIGN}`],
      ['PATCH', `/campaigns/${CAMPAIGN}`],
      ['DELETE', `/campaigns/${CAMPAIGN}`],
      ['POST', `/campaigns/${CAMPAIGN}/start`],
      ['POST', `/campaigns/${CAMPAIGN}/pause`],
      ['POST', `/campaigns/${CAMPAIGN}/resume`],
    ] as const) {
      const res = await send(path, method === 'GET' ? { method } : { method, body: '{}' })
      assert.equal(res.status, 401, `${method} ${path}`)
    }
  })
})

describe('POST /campaigns', () => {
  it('creates and answers 201', async () => {
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Prospection' }),
    })

    assert.equal(res.status, 201)
    const body = (await res.json()) as { campaign: { name: string; status: string } }
    assert.equal(body.campaign.name, 'Prospection')
    assert.equal(body.campaign.status, 'draft')
  })

  it('refuses a payload with no name', async () => {
    const res = await send('/campaigns', { method: 'POST', body: '{}' })

    assert.equal(res.status, 400)
  })

  it('refuses an out-of-range cadence', async () => {
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', start_hour: 24 }),
    })

    assert.equal(res.status, 400)
    const body = (await res.json()) as { details: { field: string }[] }
    assert.equal(body.details[0]?.field, 'start_hour')
  })

  it('never echoes the submitted value back in the error', async () => {
    // Error bodies reach logs and error reporting. The field name and the
    // reason are enough to fix a request; the value is not.
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', timezone: 'Europe/Secret-Value' }),
    })

    assert.ok(!JSON.stringify(await res.json()).includes('Secret-Value'))
  })
})

describe('GET /campaigns/:id', () => {
  it('returns the campaign', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.equal(res.status, 200)
  })

  it('answers 404 for a campaign belonging to someone else', async () => {
    stored = row({ user_id: 'bbbbbbbb-2222-4222-8222-222222222222' })

    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.equal(res.status, 404)
  })

  it('answers 404 for a malformed id, not a server error', async () => {
    const res = await send('/campaigns/not-a-uuid')

    assert.equal(res.status, 404)
  })

  it('says how much of the account’s 24-hour ceiling is spent', async () => {
    // The interface needs it to tell a user that the ceiling, not a fault, is
    // what holds a running campaign.
    accountSent = 450

    const body = (await (await send(`/campaigns/${CAMPAIGN}`)).json()) as {
      campaign: { sending: { accountSentLast24h: number; accountDailyLimit: number } }
    }

    assert.deepEqual(body.campaign.sending, {
      accountSentLast24h: 450,
      accountDailyLimit: 450,
    })
  })

  it('does not expose the owner id', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.ok(!JSON.stringify(await res.json()).includes(ALICE))
  })
})

describe('PATCH /campaigns/:id', () => {
  const patchWith = (body: unknown) =>
    send(`/campaigns/${CAMPAIGN}`, { method: 'PATCH', body: JSON.stringify(body) })

  it('edits the content of a draft', async () => {
    const res = await patchWith({ subject: 'Bonjour' })

    assert.equal(res.status, 200)
    assert.equal(lastPatch?.subject, 'Bonjour')
  })

  it('refuses to edit the content of a running campaign, with 409', async () => {
    // The payload was fine; the campaign had moved on. 400 would blame the
    // caller for something they could not have known.
    stored = row({ status: 'running' })

    const res = await patchWith({ body_html: '<p>autre chose</p>' })

    assert.equal(res.status, 409)
    assert.equal(lastPatch, null)
  })

  for (const status of ['scheduled', 'paused', 'completed'] as CampaignStatus[]) {
    it(`refuses to edit the content of a ${status} campaign`, async () => {
      stored = row({ status })

      assert.equal((await patchWith({ subject: 'x' })).status, 409)
    })
  }

  it('allows changing the pace of a paused campaign', async () => {
    stored = row({ status: 'paused' })

    assert.equal((await patchWith({ mails_per_day: 20 })).status, 200)
  })

  it('allows changing the pace of a running campaign', async () => {
    // What the dashboard's quota advice writes through. The planner re-reads
    // the pace on its next pass, and the account ceiling is counted from the
    // logs, so a raise here cannot push the account past its 24-hour limit.
    stored = row({ status: 'running' })

    assert.equal((await patchWith({ mails_per_day: 200 })).status, 200)
  })

  it('refuses to change the pace of a completed campaign', async () => {
    stored = row({ status: 'completed' })

    assert.equal((await patchWith({ mails_per_day: 200 })).status, 409)
  })

  it('refuses an empty patch', async () => {
    assert.equal((await patchWith({})).status, 400)
  })

  it('refuses an unknown field', async () => {
    assert.equal((await patchWith({ sent_count: 999 })).status, 400)
  })
})

describe('POST /campaigns/:id/preview', () => {
  const preview = (body: unknown) =>
    send(`/campaigns/${CAMPAIGN}/preview`, { method: 'POST', body: JSON.stringify(body) })

  beforeEach(() => {
    stored = row({
      subject: 'Candidature chez {{company_name}}',
      body_html: '<p>Bonjour {{salutation}} {{contact_name}}</p>',
      body_text: 'Bonjour {{salutation}} {{contact_name}}',
    })
  })

  it('renders with a stored contact', async () => {
    const res = await preview({ contact_id: CONTACT })

    assert.equal(res.status, 200)
    const body = (await res.json()) as { preview: { subject: string; bodyHtml: string } }
    assert.equal(body.preview.subject, 'Candidature chez Acme')
    assert.equal(body.preview.bodyHtml, '<p>Bonjour Madame Marie</p>')
  })

  it('renders with sample values when nothing is given', async () => {
    const res = await preview({})

    const body = (await res.json()) as { preview: { subject: string } }
    assert.match(body.preview.subject, /Société Exemple/)
  })

  it('answers 404 for a contact that is not in this campaign', async () => {
    // Scoped by campaign as well as by id, so an id borrowed from another
    // campaign previews nothing.
    const res = await preview({ contact_id: 'eeeeeeee-5555-4555-8555-555555555555' })

    assert.equal(res.status, 404)
  })

  it('stores nothing', async () => {
    await preview({ contact: { contact_name: 'Éphémère' } })

    assert.equal(lastPatch, null)
  })
})

describe('starting, pausing and resuming', () => {
  const post = (action: string) =>
    send(`/campaigns/${CAMPAIGN}/${action}`, { method: 'POST', body: '{}' })

  const ready = () =>
    row({ subject: 'Candidature', body_html: '<p>Bonjour</p>', body_text: 'Bonjour' })

  const statusOf = async (res: Response) =>
    ((await res.json()) as { campaign: { status: string } }).campaign.status

  it('schedules a ready draft and hands it to the worker at once', async () => {
    stored = ready()

    const res = await post('start')

    assert.equal(res.status, 200)
    assert.equal(await statusOf(res), 'scheduled')
    assert.deepEqual(dispatched, [CAMPAIGN])
  })

  it('refuses to start a campaign with no subject, with 422', async () => {
    stored = row({ body_html: '<p>Bonjour</p>' })

    const res = await post('start')

    assert.equal(res.status, 422)
    assert.equal(stored.status, 'draft')
    assert.deepEqual(dispatched, [])
  })

  it('refuses to start a campaign whose body is only blank space', async () => {
    stored = row({ subject: 'Candidature', body_html: '   ' })

    assert.equal((await post('start')).status, 422)
  })

  it('refuses to start a campaign with nobody left to send to', async () => {
    stored = ready()
    pendingContacts = 0

    const res = await post('start')

    assert.equal(res.status, 422)
    assert.match(((await res.json()) as { error: string }).error, /no contact/)
  })

  for (const status of [
    'scheduled',
    'running',
    'paused',
    'completed',
  ] as CampaignStatus[]) {
    it(`refuses to start a ${status} campaign, with 409`, async () => {
      // A second click on "start" lands here, and must not plan twice.
      stored = row({ ...ready(), status })

      assert.equal((await post('start')).status, 409)
      assert.deepEqual(dispatched, [])
    })
  }

  it('still answers 200 when the queue is unreachable, because the start is stored', async () => {
    // The scheduled pass picks the campaign up. A 500 here would invite a
    // second click on something that worked.
    stored = ready()
    dispatchFails = true

    const res = await post('start')

    assert.equal(res.status, 200)
    assert.equal(await statusOf(res), 'scheduled')
  })

  for (const status of ['running', 'scheduled'] as CampaignStatus[]) {
    it(`pauses a ${status} campaign without planning anything`, async () => {
      stored = row({ status })

      const res = await post('pause')

      assert.equal(res.status, 200)
      assert.equal(await statusOf(res), 'paused')
      assert.deepEqual(dispatched, [])
    })
  }

  for (const status of ['draft', 'paused', 'completed'] as CampaignStatus[]) {
    it(`refuses to pause a ${status} campaign`, async () => {
      stored = row({ status })

      assert.equal((await post('pause')).status, 409)
    })
  }

  it('resumes a paused campaign and plans it at once', async () => {
    stored = row({ status: 'paused' })

    const res = await post('resume')

    assert.equal(res.status, 200)
    assert.equal(await statusOf(res), 'running')
    assert.deepEqual(dispatched, [CAMPAIGN])
  })

  for (const status of [
    'draft',
    'scheduled',
    'running',
    'completed',
  ] as CampaignStatus[]) {
    it(`refuses to resume a ${status} campaign`, async () => {
      stored = row({ status })

      assert.equal((await post('resume')).status, 409)
    })
  }

  it('records who started, paused and resumed which campaign', async () => {
    stored = ready()

    await post('start')
    await post('pause')
    await post('resume')

    assert.deepEqual(audited, [
      `campaign.started:${CAMPAIGN}`,
      `campaign.paused:${CAMPAIGN}`,
      `campaign.resumed:${CAMPAIGN}`,
    ])
  })

  it('records nothing for a move that was refused', async () => {
    stored = row({ status: 'completed' })

    await post('start')
    await post('pause')

    assert.deepEqual(audited, [])
  })

  it('answers 404 for another user’s campaign, and moves nothing', async () => {
    stored = row({ ...ready(), user_id: 'bbbbbbbb-2222-4222-8222-222222222222' })

    for (const action of ['start', 'pause', 'resume']) {
      assert.equal((await post(action)).status, 404, action)
    }
    assert.equal(stored.status, 'draft')
  })

  it('answers 409 when another request moved the campaign first', async () => {
    stored = ready()
    raceLost = true

    assert.equal((await post('start')).status, 409)
    assert.deepEqual(dispatched, [])
  })
})

describe('DELETE /campaigns/:id', () => {
  it('deletes a draft', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`, { method: 'DELETE' })

    assert.equal(res.status, 204)
    assert.equal(removed, true)
  })

  it('refuses to delete a campaign that is sending', async () => {
    // The cascade would take the contacts and logs while jobs still reference
    // them, and lose the record of what already went out.
    stored = row({ status: 'running' })

    const res = await send(`/campaigns/${CAMPAIGN}`, { method: 'DELETE' })

    assert.equal(res.status, 409)
    assert.equal(removed, false)
  })
})
