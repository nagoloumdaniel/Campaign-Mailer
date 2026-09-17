import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { campaignTypeLabel, historyToCsv, subjectOf, type HistoryRow } from './history.js'

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 'l1',
    campaign_id: 'k1',
    campaign_name: 'Candidatures',
    campaign_type: 'alternance',
    campaign_subject: 'Candidature alternance — {{company_name}}',
    contact_id: 'c1',
    email: 'rh@exemple.fr',
    contact_name: 'Camille Martin',
    company_name: 'Société Exemple',
    salutation: 'Madame',
    outcome: 'sent',
    message: null,
    created_at: new Date('2026-09-15T12:30:00Z'),
    ...overrides,
  }
}

describe('the history export', () => {
  it('writes a header and one line per message', () => {
    const csv = historyToCsv([row(), row({ id: 'l2' })], 'UTC')
    const lines = csv.split('\r\n').filter((line) => line !== '')

    assert.equal(lines.length, 3)
    // The byte order mark sits in front of the header.
    assert.ok(lines[0]?.includes('"date","adresse","contact"'))
  })

  it('starts with a byte order mark, so Excel reads the accents', () => {
    assert.ok(historyToCsv([], 'UTC').startsWith('\uFEFF"date"'))
  })

  it('prints the date on the reader’s own clock', () => {
    const utc = historyToCsv([row()], 'UTC')
    const paris = historyToCsv([row()], 'Europe/Paris')

    assert.ok(utc.includes('2026-09-15 12:30:00'))
    // Paris is two hours ahead in September.
    assert.ok(paris.includes('2026-09-15 14:30:00'))
  })

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // The addresses came from a file the user was handed; any of them may
    // start with `=`, which a spreadsheet executes.
    const csv = historyToCsv([row({ email: '=HYPERLINK("http://evil")' })], 'UTC')

    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`))
    assert.ok(!csv.includes('"=HYPERLINK'))
  })

  it('keeps a comma inside a value from shifting the columns', () => {
    const csv = historyToCsv([row({ company_name: 'Dupont, Martin et Cie' })], 'UTC')

    assert.ok(csv.includes('"Dupont, Martin et Cie"'))
  })

  it('names the outcome in words, not as an event type', () => {
    assert.ok(historyToCsv([row()], 'UTC').includes('"envoyé"'))
    assert.ok(
      historyToCsv(
        [row({ outcome: 'failed', message: 'Adresse inconnue' })],
        'UTC',
      ).includes('"erreur","Adresse inconnue"'),
    )
  })

  it('writes an empty cell rather than "null" for a deleted contact', () => {
    const csv = historyToCsv(
      [row({ contact_id: null, email: null, contact_name: null, company_name: null })],
      'UTC',
    )

    assert.ok(csv.includes('"","","",'))
    assert.ok(!csv.includes('null'))
  })
})

describe('campaignTypeLabel', () => {
  it('names every type in the user’s words', () => {
    assert.equal(campaignTypeLabel('alternance'), 'Alternance / stage')
    assert.equal(campaignTypeLabel('relance'), 'Relance')
    assert.equal(campaignTypeLabel('prospection'), 'Prospection')
    assert.equal(campaignTypeLabel('marketing'), 'Marketing')
    assert.equal(campaignTypeLabel('autre'), 'Autre')
  })
})

describe('subjectOf', () => {
  it('shows the subject the recipient received, not the template', () => {
    assert.equal(
      subjectOf({
        id: 'l1',
        campaign_id: 'k1',
        campaign_name: 'C',
        campaign_type: 'autre',
        campaign_subject: 'Candidature — {{company_name}}',
        contact_id: 'c1',
        email: 'rh@acme.fr',
        contact_name: 'Ana',
        company_name: 'Acme',
        salutation: null,
        outcome: 'sent',
        message: null,
        created_at: new Date(),
      }),
      'Candidature — Acme',
    )
  })

  it('falls back to the template’s own default once the contact is gone', () => {
    assert.equal(
      subjectOf({
        id: 'l1',
        campaign_id: 'k1',
        campaign_name: 'C',
        campaign_type: 'autre',
        campaign_subject: 'Candidature — {{company_name|votre équipe}}',
        contact_id: null,
        email: null,
        contact_name: null,
        company_name: null,
        salutation: null,
        outcome: 'sent',
        message: null,
        created_at: new Date(),
      }),
      'Candidature — votre équipe',
    )
  })

  it('writes the rendered subject into the export', () => {
    assert.ok(
      historyToCsv([row()], 'UTC').includes('"Candidature alternance — Société Exemple"'),
    )
    assert.ok(!historyToCsv([row()], 'UTC').includes('{{'))
  })
})
