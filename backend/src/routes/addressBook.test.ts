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

function row(email: string, overrides: Partial<AddressBookRow> = {}): AddressBookRow {
  return {
    id: CONTACT,
    email,
    contact_name: 'Ana',
    company_name: 'Acme',
    salutation: null,
    source: 'csv',
    created_at: new Date('2026-09-22T08:30:00Z'),
    ...overrides,
  }
}

let lastQuery: AddressBookQuery | null = null
let lastExport: Omit<AddressBookQuery, 'limit' | 'offset'> | null = null
let lastDetails: ContactDetails | null = null
let outcome: WriteOutcome = { kind: 'saved', contact: row('a@exemple.fr') }
let imported: readonly ContactDetails[] = []

const addressBook: AddressBookRepository = {
  list: (_userId, query) => {
    lastQuery = query
    return Promise.resolve({ contacts: [row('a@exemple.fr')], total: 1 })
  },
  all: (_userId, query) => {
    lastExport = query
    return Promise.resolve([
      row('a@exemple.fr'),
      row('=cmd@exemple.fr', { company_name: '=HYPERLINK("x")', source: 'mailfind' }),
    ])
  },
  add: (_userId, details) => {
    lastDetails = details
    return Promise.resolve(outcome)
  },
  update: (_userId, _id, details) => {
    lastDetails = details
    return Promise.resolve(outcome)
  },
  remove: (_userId, id) => Promise.resolve(id === CONTACT),
  importRows: (_userId, rows) => {
    imported = rows
    // The first address is taken as already known, the others as new.
    return Promise.resolve({ imported: rows.length - 1, known: 1 })
  },
  copyToCampaign: (_userId, campaignId, ids) =>
    Promise.resolve(
      campaignId === CAMPAIGN
        ? { kind: 'copied', imported: ids.length }
        : { kind: 'not_found' },
    ),
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
  lastExport = null
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

  it('sorts by name, ascending, 25 a page, unless asked otherwise', async () => {
    assert.equal((await call('')).status, 200)
    assert.deepEqual(lastQuery, {
      sort: 'name',
      order: 'asc',
      limit: 25,
      offset: 0,
      excludeCampaignId: undefined,
    })
  })

  it('passes the search, the origin, the sort, the page and a picker’s campaign', async () => {
    await call(
      `?search=acme&source=mailfind&sort=company&order=desc&limit=10&offset=20&exclude_campaign_id=${CAMPAIGN}`,
    )

    assert.deepEqual(lastQuery, {
      search: 'acme',
      source: 'mailfind',
      sort: 'company',
      order: 'desc',
      limit: 10,
      offset: 20,
      excludeCampaignId: CAMPAIGN,
    })
  })

  it('refuses a sort or a filter that is not on the list', async () => {
    assert.equal((await call('?sort=password')).status, 400)
    assert.equal((await call('?status=sent')).status, 400)
  })

  it('answers the contact’s own details, and nothing about campaigns', async () => {
    const body = (await (await call('')).json()) as {
      contacts: Record<string, unknown>[]
      total: number
    }

    assert.equal(body.total, 1)
    assert.deepEqual(Object.keys(body.contacts[0] ?? {}).sort(), [
      'companyName',
      'contactName',
      'createdAt',
      'email',
      'id',
      'salutation',
      'source',
    ])
  })
})

describe('GET /contacts/export', () => {
  it('exports every contact the filters match, not one page', async () => {
    const res = await call(
      '/export?search=acme&sort=email&order=desc&timezone=Europe/Paris',
    )

    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(lastExport, {
      search: 'acme',
      sort: 'email',
      order: 'desc',
      excludeCampaignId: undefined,
    })
  })

  it('carries the page’s columns, dates in the reader’s zone, formulas neutralised', async () => {
    const bytes = new Uint8Array(
      await (await call('/export?timezone=Europe/Paris')).arrayBuffer(),
    )
    // Read as bytes: decoding as text would drop the mark this checks for.
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM, for Excel')
    const [header, first, second] = new TextDecoder().decode(bytes).split('\r\n')

    assert.equal(header, '"nom","email","entreprise","civilite","ajoute_le","origine"')
    // 08:30 UTC is 10:30 in Paris in September.
    assert.equal(
      first,
      '"Ana","a@exemple.fr","Acme","","2026-09-22 10:30:00","import CSV"',
    )
    assert.ok(
      !(second ?? '').includes('"=HYPERLINK'),
      'a formula must not reach a spreadsheet as one',
    )
    assert.match(second ?? '', /"MailFind"$/)
  })

  it('refuses an unknown zone', async () => {
    assert.equal((await call('/export?timezone=Nulle/Part')).status, 400)
  })
})

describe('POST /contacts/import', () => {
  it('files the valid rows, sets the others aside with their line, counts the known', async () => {
    const res = await call('/import', {
      method: 'POST',
      body: JSON.stringify({
        first_line: 2,
        rows: [
          { email: 'Ana@Exemple.fr', contact_name: 'Ana' },
          { email: 'pas une adresse' },
          { email: 'bob@exemple.fr', company_name: 'Globex' },
          { email: 'ana@exemple.fr' },
        ],
      }),
    })

    assert.equal(res.status, 201)
    const { report } = (await res.json()) as {
      report: {
        read: number
        imported: number
        known: number
        rejected: { line: number; reason: string }[]
      }
    }

    assert.deepEqual(
      imported.map((row) => row.email),
      ['ana@exemple.fr', 'bob@exemple.fr'],
    )
    assert.equal(report.read, 4)
    assert.equal(report.imported, 1)
    assert.equal(report.known, 1)
    assert.deepEqual(
      report.rejected.map((row) => [row.line, row.reason]),
      [
        [3, 'invalid_email'],
        [5, 'duplicate_in_file'],
      ],
    )
  })

  it('refuses a row with a field that is not one of the four', async () => {
    const res = await call('/import', {
      method: 'POST',
      body: JSON.stringify({ rows: [{ email: 'a@exemple.fr', campaign: 'x' }] }),
    })

    assert.equal(res.status, 400)
  })
})

describe('POST /contacts/copy', () => {
  it('copies contacts into a draft and says how many', async () => {
    const res = await call('/copy', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: CAMPAIGN, contact_ids: [CONTACT] }),
    })

    assert.equal(res.status, 201)
    assert.deepEqual(await res.json(), { imported: 1 })
  })

  it('answers 404 for a campaign that is not the user’s', async () => {
    const res = await call('/copy', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: 'eeeeeeee-5555-4555-8555-555555555555',
        contact_ids: [CONTACT],
      }),
    })

    assert.equal(res.status, 404)
  })

  it('refuses an empty selection', async () => {
    const res = await call('/copy', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: CAMPAIGN, contact_ids: [] }),
    })

    assert.equal(res.status, 400)
  })
})

describe('writing', () => {
  it('adds a contact with the four fields, the address normalised, blanks as null', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({
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

  it('refuses a field that is not one of the four', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@exemple.fr', campaign_id: CAMPAIGN }),
    })

    assert.equal(res.status, 400)
  })

  it('refuses an address that is not one, with a code', async () => {
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ email: 'pas une adresse' }),
    })

    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { code: string }).code, 'invalid_email')
  })

  it('says an address is already in the book, with a code', async () => {
    outcome = { kind: 'duplicate' }
    const res = await call(`/${CONTACT}`, {
      method: 'PATCH',
      body: JSON.stringify({ email: 'a@exemple.fr' }),
    })

    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { code: string }).code, 'duplicate_email')

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
