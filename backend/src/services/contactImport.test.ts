import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { collectContacts, normaliseEmail } from './contactImport.js'

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    assert.equal(normaliseEmail('  Marie.Dupont@Exemple.FR '), 'marie.dupont@exemple.fr')
  })

  it('accepts the shapes a real list contains', () => {
    for (const value of [
      'a@b.fr',
      'marie.dupont@exemple.fr',
      'marie+candidature@exemple.fr',
      "o'brien@exemple.ie",
      'contact@sous.domaine.exemple.fr',
      'user_name@exemple-entreprise.fr',
    ]) {
      assert.equal(normaliseEmail(value), value.toLowerCase(), value)
    }
  })

  describe('refuses', () => {
    const bad: [string, string][] = [
      ['empty', ''],
      ['whitespace only', '   '],
      ['no at sign', 'marie.exemple.fr'],
      ['two at signs', 'marie@@exemple.fr'],
      ['no domain', 'marie@'],
      ['no local part', '@exemple.fr'],
      ['domain with no dot', 'marie@exemple'],
      ['a space inside', 'marie dupont@exemple.fr'],
      ['a trailing dot', 'marie@exemple.fr.'],
      ['a leading dot in the domain', 'marie@.exemple.fr'],
      ['two dots in a row', 'marie@exemple..fr'],
      ['a comma, which is a CSV mistake', 'marie@exemple,fr'],
      ['a name and an address together', 'Marie <marie@exemple.fr>'],
      ['a newline', 'marie@exemple.fr\nbcc: autre@exemple.fr'],
    ]

    for (const [label, value] of bad) {
      it(label, () => {
        assert.equal(normaliseEmail(value), null)
      })
    }

    it('an address longer than the standard allows', () => {
      assert.equal(normaliseEmail(`${'a'.repeat(320)}@exemple.fr`), null)
    })
  })

  it('rejects a header row mistaken for data', () => {
    // Happens whenever the file has no header and the mapping is off by one.
    assert.equal(normaliseEmail('email'), null)
  })
})

describe('collectContacts', () => {
  const row = (email: string, rest: Record<string, string> = {}) => ({ email, ...rest })

  it('keeps valid rows in order', () => {
    const result = collectContacts([row('a@exemple.fr'), row('b@exemple.fr')])

    assert.deepEqual(
      result.accepted.map((contact) => contact.email),
      ['a@exemple.fr', 'b@exemple.fr'],
    )
    assert.equal(result.rejected.length, 0)
  })

  it('carries the other fields through', () => {
    const result = collectContacts([
      row('a@exemple.fr', {
        contact_name: ' Marie ',
        company_name: 'Acme',
        salutation: 'Madame',
      }),
    ])

    assert.deepEqual(result.accepted[0], {
      email: 'a@exemple.fr',
      contact_name: 'Marie',
      company_name: 'Acme',
      salutation: 'Madame',
      line: 1,
    })
  })

  it('turns a blank optional field into null, not an empty string', () => {
    // The merge treats null and blank alike, but a null says "absent" to
    // anyone reading the table later.
    const result = collectContacts([row('a@exemple.fr', { contact_name: '  ' })])

    assert.equal(result.accepted[0]?.contact_name, null)
  })

  it('reports a rejected line with its number and a reason', () => {
    const result = collectContacts([row('a@exemple.fr'), row('pas-une-adresse')])

    assert.equal(result.accepted.length, 1)
    assert.deepEqual(result.rejected, [
      { line: 2, email: 'pas-une-adresse', reason: 'invalid_email' },
    ])
  })

  it('counts the line as the user sees it, header included', () => {
    // A report saying "line 2" has to match what the spreadsheet shows, or it
    // sends the user hunting through the wrong row.
    const result = collectContacts([row('bad')], { firstLine: 2 })

    assert.equal(result.rejected[0]?.line, 2)
  })

  it('keeps the first of a duplicate and rejects the rest', () => {
    const result = collectContacts([
      row('a@exemple.fr', { contact_name: 'Premier' }),
      row('A@Exemple.FR', { contact_name: 'Second' }),
    ])

    assert.equal(result.accepted.length, 1)
    assert.equal(result.accepted[0]?.contact_name, 'Premier')
    assert.equal(result.rejected[0]?.reason, 'duplicate_in_file')
  })

  it('rejects an address already stored for the campaign', () => {
    const result = collectContacts([row('a@exemple.fr')], {
      existing: new Set(['a@exemple.fr']),
    })

    assert.equal(result.accepted.length, 0)
    assert.equal(result.rejected[0]?.reason, 'already_imported')
  })

  it('reports the totals', () => {
    const result = collectContacts([
      row('a@exemple.fr'),
      row('a@exemple.fr'),
      row('nope'),
      row('b@exemple.fr'),
    ])

    assert.deepEqual(result.summary, { read: 4, accepted: 2, rejected: 2 })
  })

  it('handles an empty file without failing', () => {
    assert.deepEqual(collectContacts([]).summary, { read: 0, accepted: 0, rejected: 0 })
  })

  it('truncates a value too long for the column rather than failing the row', () => {
    // Losing the tail of a company name is better than losing the contact.
    const result = collectContacts([
      row('a@exemple.fr', { company_name: 'x'.repeat(500) }),
    ])

    assert.equal(result.accepted[0]?.company_name?.length, 200)
  })
})

describe('collectContacts, provenance from MailFind', () => {
  it('keeps where the address was found and its verification', () => {
    const { accepted } = collectContacts([
      {
        email: 'rh@acme.fr',
        source_url: 'https://acme.fr/carrieres',
        verification_status: 'valid',
        verified_at: '2026-09-29T10:00:00Z',
      },
    ])
    assert.deepEqual(accepted[0]?.provenance, {
      source_url: 'https://acme.fr/carrieres',
      verification_status: 'valid',
      verified_at: '2026-09-29T10:00:00Z',
    })
  })

  it('gives a CSV row no provenance at all', () => {
    const { accepted } = collectContacts([{ email: 'rh@acme.fr', contact_name: 'Marie' }])
    assert.equal(accepted[0]?.provenance, undefined)
  })
})
