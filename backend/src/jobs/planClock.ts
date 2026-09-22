import type { DispatchOutcome } from '../services/dispatch.js'

/**
 * When the worker plans every campaign again.
 *
 * It used to be every fifteen minutes from whenever the process started, with
 * no relation to the clock. A campaign due at 10:00 found the plan run at 9:58,
 * before its start hour, and the next one at 10:13; that is when its first
 * message left. Each plan now says when it would find something to send — the
 * start hour, the next morning, the moment the account's window frees — and the
 * next plan runs at the earliest of those, to the second. The quarter-hour stays
 * as the longest the worker ever goes without looking.
 */

/** The longest gap between two plans, whatever the campaigns say. */
export const PLAN_AT_LEAST_EVERY_MS = 15 * 60 * 1000

/**
 * The shortest. A retry time already past — a clock a few milliseconds apart
 * from the database's — would otherwise plan in a tight loop.
 */
export const PLAN_AT_MOST_EVERY_MS = 1000

/** Milliseconds from `now` until the next plan. */
export function nextPlanDelay(outcomes: Iterable<DispatchOutcome>, now: number): number {
  let at = now + PLAN_AT_LEAST_EVERY_MS

  for (const outcome of outcomes) {
    if (outcome.retryAt) {
      at = Math.min(at, outcome.retryAt.getTime())
    }
  }

  return Math.max(PLAN_AT_MOST_EVERY_MS, at - now)
}
