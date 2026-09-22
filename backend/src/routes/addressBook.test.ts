import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type {
  AddressBookQuery,
  AddressBookRepository,
  AddressBookRow,
  ContactDetails,
  WriteOutcome,
} from '../services/addressBook.js'

import { createAddressBookRouter } from './addressBook.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'
const CONTACT = 'dddddddd-4444-4444-8444-444444444444'

function row(email: string): AddressBookRow {
  return {
    id: CONTACT,
    campaign_id: CAMPAIGN,
    campaign_name: 'Alternance',
    campaign_status: 'draft',
    campaign_type: 'alternance',
    email,
    contact_name: 'Ana',
    company_name: 'Acme',
    salutation: null,
    status: 'pending',
    source: 'csv',
    created_at: new Date('2026-09-22T10:00:00Z'),
    sent_at: null,
  }
}

let lastQuery: AddressBookQuery | null = null
let lastDetails: ContactDetails | null = null
let outcome: WriteOutcome = { kind: 'saved', contact: row('a@exemple.fr') }

const addressBook: AddressBookRepository = {
  list: (_userId, query) => {
    lastQuery = query
    return Promise.resolve({ contacts: [row('a@exemple.fr')], total: 1 })
  },
  add: (_userId, _campaignId, details) => {
    lastDetails = details
    return Promise.resolve(outcome)
  },
  update: (_userId, _contactId, details) => {
    lastDetails = details
    return Promise.resolve(outcome)
  },
  remove: (_userId, contactId) => Promise.resolve(contactId === CONTACT),
}

let baseUrl: string
let server: import('node:http').Server
let signedInAs: string | null = ALICE

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use('/contacts', createAddressBookRouter({ addressBook }))

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
  signedInAs = ALICE
  lastQuery = null
  lastDetails = null
  outcome = { kind: 'saved', contact: row('a@exemple.fr') }
})

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/contacts${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

describe('GET /contacts', () => {
  it('refuses without a session', async () => {
    signedInAs = null
    assert.equal((await call('')).status, 401)
  })

  it('sorts by company, ascending, 25 a page, unless asked otherwise', async () => {
    const res = await call('')
    assert.equal(res.status, 200)
    assert.deepEqual(lastQuery, {
      sort: 'company',
      order: 'asc',
      limit: 25,
      offset: 0,
      campaignId: undefined,
    })
  })

  it('passes the search, the filters, the sort and the page through', async () => {
    await call(
      `?search=acme&status=sent&source=mailfind&campaign_id=${CAMPAIGN}&sort=name&order=desc&limit=10&offset=20`,
    )

    assert.deepEqual(lastQuery, {
      search: 'acme',
      status: 'sent',
      source: 'mailfind',
      campaignId: CAMPAIGN,
      sort: 'name',
      order: 'desc',
      limit: 10,
      offset: 20,
    })
  })

  it('refuses a sort that is not on the list', async () => {
    assert.equal((await call('?sort=password')).status, 400)
  })

  it('answers each contact with its campaign', async () => {
    const body = (await (await call('')).json()) as {
      contacts: { campaign: { name: string }; source: string }[]
      total: number
    }

    const [first] = body.contacts
    assert.equal(body.total, 1)
    assert.ok(first)
    assert.equal(first.campaign.name, 'Alternance')
    assert.equal(first.source, 'csv')
  })
})

describe('writing', () => {
  it('creates a contact with a normalised address and blanks as null', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: CAMPAIGN,
        email: '  Ana@Exemple.FR ',
        contact_name: 'Ana',
        company_name: '   ',
      }),
    })

    assert.equal(res.status, 201)
    assert.deepEqual(lastDetails, {
      email: 'ana@exemple.fr',
      contact_name: 'Ana',
      company_name: null,
      salutation: null,
    })
  })

  it('refuses an address that is not one, with a code', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: CAMPAIGN, email: 'pas une adresse' }),
    })

    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { code: string }).code, 'invalid_email')
  })

  it('says why a write was refused, with a code', async () => {
    outcome = { kind: 'not_editable' }
    const launched = await call(`/${CONTACT}`, {
      method: 'PATCH',
      body: JSON.stringify({ email: 'a@exemple.fr' }),
    })
    assert.equal(launched.status, 409)
    assert.equal(
      ((await launched.json()) as { code: string }).code,
      'campaign_not_editable',
    )

    outcome = { kind: 'duplicate' }
    const twice = await call(`/${CONTACT}`, {
      method: 'PATCH',
      body: JSON.stringify({ email: 'a@exemple.fr' }),
    })
    assert.equal(((await twice.json()) as { code: string }).code, 'duplicate_email')

    outcome = { kind: 'not_found' }
    assert.equal(
      (
        await call(`/${CONTACT}`, {
          method: 'PATCH',
          body: JSON.stringify({ email: 'a@exemple.fr' }),
        })
      ).status,
      404,
    )
  })

  it('deletes a contact, and answers 404 for one that is not there', async () => {
    assert.equal((await call(`/${CONTACT}`, { method: 'DELETE' })).status, 204)
    assert.equal((await call('/not-a-uuid', { method: 'DELETE' })).status, 404)
    assert.equal(
      (await call('/eeeeeeee-5555-4555-8555-555555555555', { method: 'DELETE' })).status,
      404,
    )
  })
})
