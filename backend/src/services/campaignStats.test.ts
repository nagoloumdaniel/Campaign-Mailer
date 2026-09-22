import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  atLocalHour,
  estimateSchedule,
  nextOpening,
  type ScheduleInput,
} from './campaignStats.js'

const PARIS = 'Europe/Paris'
const at = (iso: string) => new Date(iso)

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    // 12:00 in Paris, in summer.
    now: at('2026-07-01T10:00:00Z'),
    status: 'running',
    pending: 5,
    mailsPerDay: 46,
    pauseMs: 30_000,
    startHour: 9,
    timezone: PARIS,
    sentLast24h: 0,
    oldestSendInWindowAt: null,
    lastSentAt: null,
    ...overrides,
  }
}

describe('atLocalHour', () => {
  it('finds nine in the morning in Paris, in summer and in winter', () => {
    assert.equal(
      atLocalHour(at('2026-07-01T15:00:00Z'), PARIS, 9).toISOString(),
      '2026-07-01T07:00:00.000Z',
    )
    assert.equal(
      atLocalHour(at('2026-01-15T15:00:00Z'), PARIS, 9).toISOString(),
      '2026-01-15T08:00:00.000Z',
    )
  })

  it('lands on the right hour the day the clocks go back', () => {
    // 25 October 2026: Paris leaves summer time at 03:00. Nine that morning is
    // already winter time, UTC+1. Reading the offset at midnight would say +2.
    assert.equal(
      atLocalHour(at('2026-10-25T12:00:00Z'), PARIS, 9).toISOString(),
      '2026-10-25T08:00:00.000Z',
    )
  })

  it('lands on the right hour the day the clocks go forward', () => {
    // 29 March 2026: Paris enters summer time at 02:00.
    assert.equal(
      atLocalHour(at('2026-03-29T12:00:00Z'), PARIS, 9).toISOString(),
      '2026-03-29T07:00:00.000Z',
    )
  })

  it('uses the calendar day in the campaign’s zone, not in UTC', () => {
    // 23:30 UTC on 1 July is already 2 July in Paris.
    assert.equal(
      atLocalHour(at('2026-07-01T23:30:00Z'), PARIS, 9).toISOString(),
      '2026-07-02T07:00:00.000Z',
    )
  })
})

describe('the next send', () => {
  it('is nothing for a campaign that is not sending', () => {
    for (const status of ['draft', 'paused', 'completed'] as const) {
      assert.deepEqual(estimateSchedule(input({ status })), {
        nextSendAt: null,
        estimatedEndAt: null,
      })
    }
  })

  it('is nothing when nobody is left to send to', () => {
    assert.equal(estimateSchedule(input({ pending: 0 })).nextSendAt, null)
  })

  it('waits for the start hour in the campaign’s zone', () => {
    // 05:00 UTC is 07:00 in Paris; the campaign starts at 09:00.
    const { nextSendAt } = estimateSchedule(input({ now: at('2026-07-01T05:00:00Z') }))
    assert.equal(nextSendAt?.toISOString(), '2026-07-01T07:00:00.000Z')
  })

  it('follows the last send by the pause', () => {
    const { nextSendAt } = estimateSchedule(
      input({ lastSentAt: at('2026-07-01T09:59:50Z'), sentLast24h: 3 }),
    )
    assert.equal(nextSendAt?.toISOString(), '2026-07-01T10:00:20.000Z')
  })

  it('is now when the pause after the last send is already over', () => {
    const { nextSendAt } = estimateSchedule(
      input({ lastSentAt: at('2026-07-01T09:00:00Z'), sentLast24h: 3 }),
    )
    assert.equal(nextSendAt?.toISOString(), '2026-07-01T10:00:00.000Z')
  })

  it('waits for the 24-hour window to free once the day’s pace is spent', () => {
    const { nextSendAt } = estimateSchedule(
      input({
        sentLast24h: 46,
        oldestSendInWindowAt: at('2026-06-30T13:00:00Z'),
        lastSentAt: at('2026-07-01T09:00:00Z'),
      }),
    )
    assert.equal(nextSendAt?.toISOString(), '2026-07-01T13:00:00.000Z')
  })

  it('still waits for the start hour when the window frees in the night', () => {
    // The window frees at 03:00 in Paris; the campaign only sends from 09:00.
    const { nextSendAt } = estimateSchedule(
      input({
        sentLast24h: 46,
        oldestSendInWindowAt: at('2026-07-01T01:00:00Z'),
      }),
    )
    assert.equal(nextSendAt?.toISOString(), '2026-07-02T07:00:00.000Z')
  })
})

describe('the estimated end', () => {
  it('finishes the same day when the pace covers everyone', () => {
    // Five contacts, thirty seconds apart plus ten percent average jitter.
    const { nextSendAt, estimatedEndAt } = estimateSchedule(input())
    assert.ok(nextSendAt && estimatedEndAt)
    assert.equal(estimatedEndAt.getTime() - nextSendAt.getTime(), 4 * 33_000)
  })

  it('counts the days a larger list needs, ending on the last one’s batch', () => {
    // 100 contacts at 46 a day: 46 today, 46 tomorrow, 8 the day after.
    const { estimatedEndAt } = estimateSchedule(input({ pending: 100 }))
    const lastDayStart = at('2026-07-03T07:00:00Z').getTime()
    assert.equal(estimatedEndAt?.getTime(), lastDayStart + 7 * 33_000)
  })

  it('counts only what is left of today’s pace for the first day', () => {
    // 40 already sent today: 6 more today, 46 tomorrow, 46 the day after, and
    // the last 2 on day four.
    const { estimatedEndAt } = estimateSchedule(
      input({ pending: 100, sentLast24h: 40, lastSentAt: at('2026-07-01T09:59:00Z') }),
    )
    const dayFourStart = at('2026-07-04T07:00:00Z').getTime()
    assert.equal(estimatedEndAt?.getTime(), dayFourStart + 1 * 33_000)
  })
})

describe('the sending week', () => {
  it('opens the next morning that is not a Sunday', () => {
    // Saturday 4 July at 19:30 in Paris: nothing until Monday 09:00.
    assert.equal(
      nextOpening(at('2026-07-04T17:30:00Z'), PARIS, 9).toISOString(),
      '2026-07-06T07:00:00.000Z',
    )
    // Sunday noon, the same.
    assert.equal(
      nextOpening(at('2026-07-05T10:00:00Z'), PARIS, 9).toISOString(),
      '2026-07-06T07:00:00.000Z',
    )
    // Wednesday at 07:00 in Paris: the same morning.
    assert.equal(
      nextOpening(at('2026-07-01T05:00:00Z'), PARIS, 9).toISOString(),
      '2026-07-01T07:00:00.000Z',
    )
  })

  it('estimates a Sunday send on Monday morning', () => {
    const { nextSendAt } = estimateSchedule(input({ now: at('2026-07-05T10:00:00Z') }))
    assert.equal(nextSendAt?.toISOString(), '2026-07-06T07:00:00.000Z')
  })

  it('counts a multi-day campaign in sending days, Sundays skipped', () => {
    // Saturday noon, 92 left at 46 a day: Saturday, then Monday, not Sunday.
    const { estimatedEndAt } = estimateSchedule(
      input({ now: at('2026-07-04T10:00:00Z'), pending: 92 }),
    )
    assert.equal(estimatedEndAt?.toISOString().slice(0, 10), '2026-07-06')
  })
})

describe('a launch scheduled for later', () => {
  it('sends nothing before the day and hour chosen', () => {
    const sendAfter = at('2026-07-03T08:30:00Z')
    const { nextSendAt } = estimateSchedule(input({ status: 'scheduled', sendAfter }))
    assert.equal(nextSendAt?.toISOString(), sendAfter.toISOString())
  })

  it('is ignored once it has passed', () => {
    const { nextSendAt } = estimateSchedule(
      input({ sendAfter: at('2026-06-30T08:30:00Z') }),
    )
    assert.equal(nextSendAt?.toISOString(), '2026-07-01T10:00:00.000Z')
  })
})
