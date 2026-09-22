import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createCampaignSchema,
  insideSendingWindow,
  previewSchema,
  startCampaignSchema,
  updateCampaignSchema,
} from './campaign.js'

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
      // The start hour and the pause are the application's since
      // 22 September 2026: a client may not send them at all.
      ['start_hour at all', { start_hour: 9 }, false],
      ['pause_ms at all', { pause_ms: 30_000 }, false],
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
    assert.equal(updateCampaignSchema.safeParse({ mails_per_day: 20 }).success, true)
  })

  it('refuses an empty payload', () => {
    // Almost always a bug in the caller. Answering 200 would hide it.
    assert.equal(updateCampaignSchema.safeParse({}).success, false)
  })

  it('applies the same bounds as creation', () => {
    assert.equal(updateCampaignSchema.safeParse({ mails_per_day: 451 }).success, false)
    assert.equal(updateCampaignSchema.safeParse({ pause_ms: 10_000 }).success, false)
  })
})

describe('startCampaignSchema', () => {
  const soon = () => new Date(Date.now() + 3_600_000).toISOString()

  it('accepts no schedule at all: as soon as the window allows', () => {
    assert.equal(startCampaignSchema.safeParse({}).success, true)
  })

  it('accepts a day and hour ahead, with the browser’s zone', () => {
    assert.equal(
      startCampaignSchema.safeParse({ send_after: soon(), timezone: 'Europe/Paris' })
        .success,
      true,
    )
  })

  it('refuses a moment in the past, or beyond ninety days', () => {
    const past = new Date(Date.now() - 3_600_000).toISOString()
    const far = new Date(Date.now() + 91 * 86_400_000).toISOString()

    assert.equal(startCampaignSchema.safeParse({ send_after: past }).success, false)
    assert.equal(startCampaignSchema.safeParse({ send_after: far }).success, false)
  })

  it('refuses a date without its offset, which would be read in the server’s zone', () => {
    assert.equal(
      startCampaignSchema.safeParse({ send_after: '2026-10-01T10:00:00' }).success,
      false,
    )
  })
})

describe('insideSendingWindow', () => {
  // 1 July 2026 is a Wednesday; Paris is UTC+2 in summer.
  it('opens at 09:00 and closes after 18:59, on the campaign’s clock', () => {
    assert.equal(
      insideSendingWindow(new Date('2026-07-01T06:59:00Z'), 'Europe/Paris'),
      false,
    )
    assert.equal(
      insideSendingWindow(new Date('2026-07-01T07:00:00Z'), 'Europe/Paris'),
      true,
    )
    assert.equal(
      insideSendingWindow(new Date('2026-07-01T16:59:00Z'), 'Europe/Paris'),
      true,
    )
    assert.equal(
      insideSendingWindow(new Date('2026-07-01T17:00:00Z'), 'Europe/Paris'),
      false,
    )
  })

  it('is open on Saturday and closed on Sunday', () => {
    assert.equal(
      insideSendingWindow(new Date('2026-07-04T10:00:00Z'), 'Europe/Paris'),
      true,
    )
    assert.equal(
      insideSendingWindow(new Date('2026-07-05T10:00:00Z'), 'Europe/Paris'),
      false,
    )
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
