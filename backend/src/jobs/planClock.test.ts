import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DispatchOutcome } from '../services/dispatch.js'

import {
  PLAN_AT_LEAST_EVERY_MS,
  PLAN_AT_MOST_EVERY_MS,
  nextPlanDelay,
} from './planClock.js'

const NOW = Date.parse('2026-09-22T07:58:00Z')

describe('when the worker plans again', () => {
  it('waits a quarter of an hour when no campaign names a time', () => {
    const outcomes: DispatchOutcome[] = [
      { kind: 'nothing_pending' },
      { kind: 'completed' },
    ]
    assert.equal(nextPlanDelay(outcomes, NOW), PLAN_AT_LEAST_EVERY_MS)
  })

  it('plans at the start hour itself, not at the next quarter-hour', () => {
    // 09:58 in Paris; the campaign starts at 10:00. The old timer ran at 10:13.
    const opens = new Date('2026-09-22T08:00:00Z')
    const outcomes: DispatchOutcome[] = [{ kind: 'before_start_hour', retryAt: opens }]

    assert.equal(nextPlanDelay(outcomes, NOW), 2 * 60 * 1000)
  })

  it('takes the earliest of several campaigns', () => {
    const outcomes: DispatchOutcome[] = [
      { kind: 'before_start_hour', retryAt: new Date(NOW + 90_000) },
      { kind: 'account_quota_reached', retryAt: new Date(NOW + 30_000) },
      { kind: 'after_send_window', retryAt: new Date(NOW + 12 * 3600_000) },
    ]

    assert.equal(nextPlanDelay(outcomes, NOW), 30_000)
  })

  it('never plans in a tight loop on a time already past', () => {
    const outcomes: DispatchOutcome[] = [
      { kind: 'account_quota_reached', retryAt: new Date(NOW - 5) },
    ]

    assert.equal(nextPlanDelay(outcomes, NOW), PLAN_AT_MOST_EVERY_MS)
  })

  it('never waits longer than a quarter of an hour', () => {
    const outcomes: DispatchOutcome[] = [
      { kind: 'after_send_window', retryAt: new Date(NOW + 16 * 3600_000) },
    ]

    assert.equal(nextPlanDelay(outcomes, NOW), PLAN_AT_LEAST_EVERY_MS)
  })
})
