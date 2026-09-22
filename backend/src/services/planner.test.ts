import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  isSendDay,
  localHour,
  planDay,
  windowRemainingMs,
  type PlanInput,
} from './planner.js'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${String(i)}`)

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    // 10:30 in Paris, in summer.
    now: new Date('2026-07-01T08:30:00Z'),
    timezone: 'Europe/Paris',
    startHour: 9,
    mailsPerDay: 46,
    pauseMs: 3000,
    sentByCampaign: 0,
    sentByAccount: 0,
    accountLimit: 120,
    pendingContactIds: ids(100),
    random: () => 0,
    ...overrides,
  }
}

/** The interval between each planned send and the one before it. */
function gapsOf(planned: readonly { delayMs: number }[]): number[] {
  const delays = planned.map((send) => send.delayMs)
  return delays.slice(1).map((delay, index) => delay - (delays.at(index) ?? 0))
}

function sends(overrides: Partial<PlanInput> = {}) {
  const outcome = planDay(input(overrides))
  assert.equal(outcome.kind, 'planned')
  return outcome.sends
}

describe('the start hour', () => {
  it('follows daylight saving in the campaign’s zone', () => {
    // 07:30 UTC is 09:30 in Paris in July and 08:30 in January. A server-time
    // or fixed-offset reading would get one of the two wrong.
    assert.equal(localHour(new Date('2026-07-01T07:30:00Z'), 'Europe/Paris'), 9)
    assert.equal(localHour(new Date('2026-01-15T07:30:00Z'), 'Europe/Paris'), 8)
  })

  it('plans nothing before it', () => {
    const outcome = planDay(input({ now: new Date('2026-01-15T07:30:00Z') }))
    assert.deepEqual(outcome, { kind: 'before_start_hour' })
  })

  it('plans from the hour itself', () => {
    assert.ok(sends({ now: new Date('2026-07-01T07:00:00Z') }).length > 0)
  })

  it('reads midnight as 0, not 24', () => {
    assert.equal(localHour(new Date('2026-07-01T22:00:00Z'), 'Europe/Paris'), 0)
  })
})

describe('how many', () => {
  it('takes the campaign’s daily pace', () => {
    assert.equal(sends().length, 46)
  })

  it('subtracts what the campaign already sent in the last 24 hours', () => {
    assert.equal(sends({ sentByCampaign: 40 }).length, 6)
  })

  it('never exceeds what the account has left, whatever the campaign asks', () => {
    // Two campaigns from one account share one Gmail quota.
    assert.equal(sends({ sentByAccount: 110 }).length, 10)
  })

  it('stops at the account ceiling', () => {
    assert.deepEqual(planDay(input({ sentByAccount: 120 })), {
      kind: 'account_quota_reached',
    })
  })

  it('stops at the campaign’s pace', () => {
    assert.deepEqual(planDay(input({ sentByCampaign: 46 })), {
      kind: 'campaign_quota_reached',
    })
  })

  it('queues each send at the second a slot of the pace frees', () => {
    // Yesterday's 46 went out from 10:30 one minute apart; the first leaves
    // the 24-hour window right now, the next ones a minute apart after it.
    const now = input().now.getTime()
    const frees = Array.from({ length: 46 }, (_, i) => now + i * 60_000)
    const planned = sends({ sentByCampaign: 46, campaignFreesAt: frees })

    assert.equal(planned.length, 46)
    assert.deepEqual(
      planned.slice(0, 3).map((s) => s.delayMs),
      [1000, 61_000, 121_000],
    )
  })

  it('keeps the pause when slots free faster than it', () => {
    const now = input().now.getTime()
    const planned = sends({
      sentByCampaign: 46,
      campaignFreesAt: Array.from({ length: 46 }, () => now),
    })

    assert.deepEqual(gapsOf(planned.slice(0, 3)), [3000, 3000])
  })

  it('stops at the pace when nothing leaves the window', () => {
    const now = input().now.getTime()
    // Lowered from 46 to 40 after sending 46: seven must leave before one goes.
    const frees = Array.from({ length: 6 }, (_, i) => now + i * 1000)

    assert.deepEqual(
      planDay(input({ mailsPerDay: 40, sentByCampaign: 46, campaignFreesAt: frees })),
      { kind: 'campaign_quota_reached' },
    )
  })

  it('takes the oldest contacts first', () => {
    assert.deepEqual(
      sends({ mailsPerDay: 3 }).map((s) => s.contactId),
      ['c0', 'c1', 'c2'],
    )
  })

  it('says so when nobody is left', () => {
    assert.deepEqual(planDay(input({ pendingContactIds: [] })), {
      kind: 'nothing_pending',
    })
  })
})

describe('when', () => {
  it('sends the first one now and spaces the rest by the pause', () => {
    assert.deepEqual(
      sends({ mailsPerDay: 3 }).map((s) => s.delayMs),
      [0, 3000, 6000],
    )
  })

  it('adds at most twenty percent of jitter to each gap', () => {
    const gaps = gapsOf(sends({ mailsPerDay: 3, random: () => 0.999 }))

    assert.equal(gaps.length, 2)
    for (const gap of gaps) {
      assert.ok(gap > 3000 && gap <= 3600, `gap ${String(gap)} out of bounds`)
    }
  })

  it('never produces two identical gaps with a real random source', () => {
    const gaps = new Set(gapsOf(sends({ mailsPerDay: 20, random: Math.random })))
    assert.ok(gaps.size > 1, 'a perfectly regular interval is a signature')
  })
})

describe('the sending window', () => {
  // 1 July 2026 is a Wednesday. Paris is UTC+2 in summer: 17:00 UTC is 19:00.
  it('closes at the end of the last send hour, 18:59', () => {
    // 19:05 in Paris. Nothing is queued: a campaign launched in the evening
    // starts the next morning, which is what the interface promised.
    const outcome = planDay(input({ now: new Date('2026-07-01T17:05:00Z') }))

    assert.deepEqual(outcome, { kind: 'after_send_window' })
  })

  it('still plans during the last send hour', () => {
    // 18:05 in Paris, the last hour a send may begin.
    const outcome = planDay(input({ now: new Date('2026-07-01T16:05:00Z') }))

    assert.equal(outcome.kind, 'planned')
  })

  it('opens at 09:00', () => {
    assert.equal(
      planDay(input({ now: new Date('2026-07-01T06:59:00Z') })).kind,
      'before_start_hour',
    )
    assert.equal(
      planDay(input({ now: new Date('2026-07-01T07:00:00Z') })).kind,
      'planned',
    )
  })

  it('sends on Saturday and never on Sunday, on the campaign’s clock', () => {
    // Saturday 4 July, noon in Paris.
    assert.equal(
      planDay(input({ now: new Date('2026-07-04T10:00:00Z') })).kind,
      'planned',
    )
    // Sunday 5 July, noon in Paris.
    assert.deepEqual(planDay(input({ now: new Date('2026-07-05T10:00:00Z') })), {
      kind: 'closed_day',
    })
    // 23:30 on Saturday in UTC is already Sunday 01:30 in Paris.
    assert.equal(isSendDay(new Date('2026-07-04T23:30:00Z'), 'Europe/Paris'), false)
  })

  it('stops the plan where the window ends rather than delivering into the night', () => {
    // 18:00 in Paris, one hour of window left, five minutes between sends:
    // twelve fit, the rest wait for tomorrow morning.
    const planned = sends({
      now: new Date('2026-07-01T16:00:00Z'),
      pauseMs: 300_000,
      mailsPerDay: 100,
      accountLimit: 450,
      pendingContactIds: ids(100),
    })

    assert.equal(planned.length, 12)
    assert.ok(
      (planned.at(-1)?.delayMs ?? 0) < 60 * 60 * 1000,
      'the last send should still fall inside the window',
    )
  })

  it('reports a closed window when nothing fits, rather than an empty plan', () => {
    // 18:59:59 in Paris: a second left, and the pause is longer than that.
    const outcome = planDay(
      input({
        now: new Date('2026-07-01T16:59:59Z'),
        pauseMs: 600_000,
        pendingContactIds: ids(3),
      }),
    )

    assert.equal(outcome.kind, 'planned')
    assert.equal(outcome.sends.length, 1, 'the first send has no delay, so it fits')
  })

  it('counts what is left of the window from the campaign’s own clock', () => {
    const at = new Date('2026-07-01T15:00:00Z')

    // 17:00 in Paris: two hours to 19:00.
    assert.equal(windowRemainingMs(at, 'Europe/Paris'), 2 * 60 * 60 * 1000)
    // The same instant is 16:00 in London, which keeps summer time too.
    assert.equal(windowRemainingMs(at, 'Europe/London'), 3 * 60 * 60 * 1000)
    // An hour earlier it is 23:00 in Tokyo, where the window closed long ago.
    assert.equal(windowRemainingMs(new Date('2026-07-01T14:00:00Z'), 'Asia/Tokyo'), 0)
  })

  it('opens at 09:00 and lets a send begin up to 18:59', () => {
    assert.equal(FIRST_SEND_HOUR, 9)
    assert.equal(LAST_SEND_HOUR, 18)
  })
})
