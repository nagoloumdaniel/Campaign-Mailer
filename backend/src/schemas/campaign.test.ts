import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCampaignSchema, previewSchema, updateCampaignSchema } from './campaign.js'

const VALID = { name: 'Candidatures septembre' }

describe('createCampaignSchema', () => {
  it('accepts a campaign with just a name', () => {
    assert.equal(createCampaignSchema.parse(VALID).name, VALID.name)
  })

  it('trims the name before judging its length', () => {
    assert.equal(createCampaignSchema.parse({ name: '  Août  ' }).name, 'Août')
  })

  it('refuses a name of spaces', () => {
    assert.equal(createCampaignSchema.safeParse({ name: '   ' }).success, false)
  })

  it('refuses a missing name', () => {
    assert.equal(createCampaignSchema.safeParse({}).success, false)
  })

  it('refuses an unknown field rather than dropping it', () => {
    // A typo in a field name would otherwise be accepted in silence and the
    // value never stored, which looks like the save failing at random.
    assert.equal(
      createCampaignSchema.safeParse({ ...VALID, mails_per_days: 40 }).success,
      false,
    )
  })

  it('refuses a body past the limit', () => {
    assert.equal(
      createCampaignSchema.safeParse({ ...VALID, body_html: 'x'.repeat(100_001) })
        .success,
      false,
    )
  })

  describe('cadence bounds mirror the database constraints', () => {
    const cases: [string, unknown, boolean][] = [
      ['mails_per_day at 1', { mails_per_day: 1 }, true],
      // 450: Google blocks a personal account past 500 a day, and the user's
      // own messages count too.
      ['mails_per_day at 450', { mails_per_day: 450 }, true],
      ['mails_per_day at 0', { mails_per_day: 0 }, false],
      ['mails_per_day at 451', { mails_per_day: 451 }, false],
      ['mails_per_day fractional', { mails_per_day: 1.5 }, false],
      // Office hours only: nothing is sent before 10:00 or after 17:59.
      ['start_hour at 10', { start_hour: 10 }, true],
      ['start_hour at 17', { start_hour: 17 }, true],
      ['start_hour at 9', { start_hour: 9 }, false],
      ['start_hour at 18', { start_hour: 18 }, false],
      ['start_hour at 0', { start_hour: 0 }, false],
      ['start_hour negative', { start_hour: -1 }, false],
      ['pause_ms at 10000', { pause_ms: 10_000 }, true],
      ['pause_ms at 9999', { pause_ms: 9_999 }, false],
      ['pause_ms at the old 3000 default', { pause_ms: 3000 }, false],
      ['pause_ms at 600000', { pause_ms: 600_000 }, true],
      ['pause_ms at 600001', { pause_ms: 600_001 }, false],
    ]

    for (const [label, patch, expected] of cases) {
      it(`${expected ? 'accepts' : 'refuses'} ${label}`, () => {
        assert.equal(
          createCampaignSchema.safeParse({ ...VALID, ...(patch as object) }).success,
          expected,
        )
      })
    }
  })

  describe('timezone', () => {
    it('accepts an IANA name', () => {
      assert.equal(
        createCampaignSchema.safeParse({ ...VALID, timezone: 'Europe/Paris' }).success,
        true,
      )
    })

    it('refuses something that is not a zone', () => {
      // The worker resolves the start hour in this zone. A wrong one would
      // send at the wrong time of day rather than fail loudly.
      assert.equal(
        createCampaignSchema.safeParse({ ...VALID, timezone: 'Europe/Nulle-Part' })
          .success,
        false,
      )
    })

    it('refuses a fixed offset, which Intl otherwise accepts', () => {
      // An offset does not follow daylight saving, so "send at 9" would go out
      // at 8 or at 10 for half the year.
      for (const offset of ['+02:00', '-05:00', 'GMT+2']) {
        assert.equal(
          createCampaignSchema.safeParse({ ...VALID, timezone: offset }).success,
          false,
          offset,
        )
      }
    })

    it('accepts UTC and a three-part zone name', () => {
      for (const zone of ['UTC', 'America/Argentina/Buenos_Aires']) {
        assert.equal(
          createCampaignSchema.safeParse({ ...VALID, timezone: zone }).success,
          true,
          zone,
        )
      }
    })
  })

  it('refuses a number sent as a string', () => {
    assert.equal(
      createCampaignSchema.safeParse({ ...VALID, mails_per_day: '40' }).success,
      false,
    )
  })
})

describe('updateCampaignSchema', () => {
  it('accepts a single field', () => {
    assert.equal(updateCampaignSchema.safeParse({ start_hour: 14 }).success, true)
  })

  it('refuses an empty payload', () => {
    // Almost always a bug in the caller. Answering 200 would hide it.
    assert.equal(updateCampaignSchema.safeParse({}).success, false)
  })

  it('applies the same bounds as creation', () => {
    assert.equal(updateCampaignSchema.safeParse({ start_hour: 18 }).success, false)
  })
})

describe('previewSchema', () => {
  it('accepts a stored contact', () => {
    assert.equal(
      previewSchema.safeParse({ contact_id: '11111111-2222-4333-8444-555555555555' })
        .success,
      true,
    )
  })

  it('accepts made-up values, for a campaign with no contacts yet', () => {
    assert.equal(
      previewSchema.safeParse({ contact: { contact_name: 'Marie' } }).success,
      true,
    )
  })

  it('accepts an empty payload, meaning sample values', () => {
    assert.equal(previewSchema.safeParse({}).success, true)
  })

  it('refuses an id that is not a uuid', () => {
    assert.equal(previewSchema.safeParse({ contact_id: 'nope' }).success, false)
  })
})
