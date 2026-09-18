import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import type { ImportedContact } from '../services/contactImport.js'
import type {
  ContactRepository,
  ContactRow,
  ContactStatus,
} from '../services/contacts.js'

import { createContactRouter } from './contacts.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'
const CONTACT = 'dddddddd-4444-4444-8444-444444444444'

let campaignStatus: CampaignRow['status'] = 'draft'
let inserted: ImportedContact[] = []
let stored = new Set<string>()
let removedIds: string[] = []

const campaigns = {
  findForUser: (id: string, userId: string) =>
    Promise.resolve(
      id === CAMPAIGN && userId === ALICE
        ? ({ id: CAMPAIGN, status: campaignStatus } as CampaignRow)
        : null,
    ),
} as unknown as CampaignRepository

function contactRow(email: string, status: ContactStatus = 'pending'): ContactRow {
  return {
    id: CONTACT,
    campaign_id: CAMPAIGN,
    email,
    company_name: null,
    contact_name: null,
    salutation: null,
    status,
    error_message: null,
    attempts: 0,
    created_at: new Date('2026-09-13T10:00:00Z'),
    sent_at: null,
    opened_at: null,
    clicked_at: null,
  }
}

const contacts: ContactRepository = {
  existingEmails: () => Promise.resolve(stored),
  insertMany: (_campaignId, rows) => {
    inserted = rows
    return Promise.resolve(rows.length)
  },
  list: () => Promise.resolve({ contacts: [contactRow('a@exemple.fr')], total: 1 }),
  add: (_campaignId, contact) =>
    Promise.resolve(stored.has(contact.email) ? null : contactRow(contact.email)),
  update: (_campaignId, contactId, patch) =>
    Promise.resolve(
      contactId === CONTACT
        ? contactRow('a@exemple.fr', patch.status ?? 'pending')
        : null,
    ),
  remove: (_campaignId, contactId) => {
    removedIds.push(contactId)
    return Promise.resolve(contactId === CONTACT)
  },
}

let baseUrl: string
let server: import('node:http').Server
let signedInAs: string | null = ALICE

before(async () => {
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use('/campaigns/:id/contacts', createContactRouter({ campaigns, contacts }))

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
  campaignStatus = 'draft'
  inserted = []
  stored = new Set()
  removedIds = []
  signedInAs = ALICE
})

const send = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/campaigns/${CAMPAIGN}/contacts${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const importRows = (rows: unknown[], firstLine?: number) =>
  send('/import', {
    method: 'POST',
    body: JSON.stringify({ rows, ...(firstLine ? { first_line: firstLine } : {}) }),
  })

describe('access', () => {
  it('refuses without a session', async () => {
    signedInAs = null

    assert.equal((await send('/')).status, 401)
  })

  it('answers 404 under a campaign belonging to someone else', async () => {
    signedInAs = 'bbbbbbbb-2222-4222-8222-222222222222'

    assert.equal((await send('/')).status, 404)
  })

  it('answers 404 under a malformed campaign id', async () => {
    const res = await fetch(`${baseUrl}/campaigns/pas-un-uuid/contacts`)

    assert.equal(res.status, 404)
  })
})

describe('POST import', () => {
  it('imports valid rows and reports the count', async () => {
    const res = await importRows([{ email: 'a@exemple.fr' }, { email: 'b@exemple.fr' }])

    assert.equal(res.status, 201)
    const body = (await res.json()) as { report: { read: number; imported: number } }
    assert.deepEqual(body.report, { read: 2, imported: 2, rejected: [] })
  })

  it('rejects bad rows without losing the good ones', async () => {
    // The whole point of the report: a file is never entirely clean, and
    // refusing it wholesale makes the user fix a spreadsheet blind.
    const res = await importRows([
      { email: 'a@exemple.fr' },
      { email: 'pas-une-adresse' },
      { email: 'b@exemple.fr' },
    ])

    const body = (await res.json()) as {
      report: { imported: number; rejected: { line: number; reason: string }[] }
    }
    assert.equal(body.report.imported, 2)
    assert.deepEqual(body.report.rejected, [
      { line: 2, email: 'pas-une-adresse', reason: 'invalid_email' },
    ])
  })

  it('numbers the lines as the spreadsheet does', async () => {
    const res = await importRows([{ email: 'nope' }], 2)

    const body = (await res.json()) as { report: { rejected: { line: number }[] } }
    assert.equal(body.report.rejected[0]?.line, 2)
  })

  it('rejects an address already in the campaign', async () => {
    stored = new Set(['a@exemple.fr'])

    const res = await importRows([{ email: 'A@Exemple.fr' }])

    const body = (await res.json()) as { report: { rejected: { reason: string }[] } }
    assert.equal(body.report.rejected[0]?.reason, 'already_imported')
    assert.equal(inserted.length, 0)
  })

  it('refuses once the campaign has left draft', async () => {
    // Adding recipients to a campaign already sending would send them a
    // message planned against a different list.
    campaignStatus = 'running'

    assert.equal((await importRows([{ email: 'a@exemple.fr' }])).status, 409)
  })

  it('refuses more rows than one batch allows', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({ email: `x${String(i)}@e.fr` }))

    assert.equal((await importRows(rows)).status, 400)
  })

  it('refuses an unknown field in a row', async () => {
    assert.equal((await importRows([{ email: 'a@e.fr', statut: 'sent' }])).status, 400)
  })

  it('accepts an empty file', async () => {
    const res = await importRows([])

    assert.equal(res.status, 201)
  })
})

describe('POST one contact', () => {
  it('adds it', async () => {
    const res = await send('/', {
      method: 'POST',
      body: JSON.stringify({ email: ' Marie@Exemple.FR ' }),
    })

    assert.equal(res.status, 201)
    const body = (await res.json()) as { contact: { email: string } }
    assert.equal(body.contact.email, 'marie@exemple.fr')
  })

  it('refuses an invalid address', async () => {
    const res = await send('/', {
      method: 'POST',
      body: JSON.stringify({ email: 'nope' }),
    })

    assert.equal(res.status, 400)
    assert.equal(await codeOf(res), 'invalid_email')
  })

  it('answers 409 on an address already there', async () => {
    stored = new Set(['a@exemple.fr'])

    const res = await send('/', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@exemple.fr' }),
    })

    assert.equal(res.status, 409)
    // The code, not the sentence: a client tells this refusal apart from the
    // one below to say which of them happened, and English prose is not a
    // contract.
    assert.equal(await codeOf(res), 'duplicate_email')
  })

  it('answers 409 once the campaign has left draft', async () => {
    campaignStatus = 'running'

    const res = await send('/', {
      method: 'POST',
      body: JSON.stringify({ email: 'neuf@exemple.fr' }),
    })

    assert.equal(res.status, 409)
    assert.equal(await codeOf(res), 'campaign_not_editable')
  })
})

/** The machine-readable reason a refusal carries, which clients match on. */
async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

describe('PATCH a contact', () => {
  it('sets it aside', async () => {
    const res = await send(`/${CONTACT}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ignored' }),
    })

    assert.equal(res.status, 200)
    const body = (await res.json()) as { contact: { status: string } }
    assert.equal(body.contact.status, 'ignored')
  })

  it('refuses a status the send engine owns', async () => {
    // Letting a client write `sent` would corrupt the record of what actually
    // went out, which is the only account of it that exists.
    for (const status of ['sent', 'failed']) {
      const res = await send(`/${CONTACT}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })

      assert.equal(res.status, 400, status)
    }
  })

  it('answers 404 for an unknown contact', async () => {
    const res = await send('/eeeeeeee-5555-4555-8555-555555555555', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending' }),
    })

    assert.equal(res.status, 404)
  })
})

describe('DELETE a contact', () => {
  it('removes it', async () => {
    const res = await send(`/${CONTACT}`, { method: 'DELETE' })

    assert.equal(res.status, 204)
    assert.deepEqual(removedIds, [CONTACT])
  })

  it('answers 404 for a malformed id without touching the database', async () => {
    const res = await send('/pas-un-uuid', { method: 'DELETE' })

    assert.equal(res.status, 404)
    assert.deepEqual(removedIds, [])
  })
})
