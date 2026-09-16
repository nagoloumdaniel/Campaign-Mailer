import type { CampaignStatus } from './campaignState.js'
import { LAST_SEND_HOUR, localHour } from './planner.js'

/**
 * When a campaign will next send, and when it should finish.
 *
 * Pure, and built on the planner's own rules rather than on the queue: reading
 * delayed jobs out of Redis for every page view would spend commands on a
 * number that is an estimate either way. What it cannot see is the account's
 * ceiling being spent by another campaign of the same user, so the end date is
 * a lower bound, and the interface says "estimée".
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** The planner adds up to twenty percent of jitter; on average, ten. */
const AVERAGE_GAP_FACTOR = 1.1

export interface ScheduleInput {
  now: Date
  status: CampaignStatus
  pending: number
  mailsPerDay: number
  pauseMs: number
  startHour: number
  timezone: string
  /** What this campaign sent over the last 24 hours. */
  sentLast24h: number
  /** The oldest of those sends: the window frees 24 hours after it. */
  oldestSendInWindowAt: Date | null
  lastSentAt: Date | null
}

export interface ScheduleEstimate {
  nextSendAt: Date | null
  estimatedEndAt: Date | null
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(date: Date, timezone: string): WallClock {
  const clock: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)

  // A switch rather than indexing the object by the part's type: the type is a
  // string from the runtime, and the linter is right that it should not choose
  // which property gets written.
  for (const part of parts) {
    const value = Number(part.value)
    switch (part.type) {
      case 'year':
        clock.year = value
        break
      case 'month':
        clock.month = value
        break
      case 'day':
        clock.day = value
        break
      case 'hour':
        clock.hour = value
        break
      case 'minute':
        clock.minute = value
        break
      case 'second':
        clock.second = value
        break
      default:
        break
    }
  }

  return clock
}

/** How far `timezone` is ahead of UTC at `date`, in milliseconds. */
function offsetMs(date: Date, timezone: string): number {
  const c = wallClock(date, timezone)
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second)
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * The instant at which the wall clock in `timezone` reads `hour`:00, on the
 * calendar day `reference` falls on there.
 *
 * The offset is read twice: once at a first guess, once at the result. On the
 * two days a year the clocks change, the offset at nine in the morning is not
 * the offset at midnight, and one reading would land an hour off.
 */
export function atLocalHour(reference: Date, timezone: string, hour: number): Date {
  const day = wallClock(reference, timezone)
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour)
  const first = guess - offsetMs(new Date(guess), timezone)

  return new Date(guess - offsetMs(new Date(first), timezone))
}

/** The next instant the wall clock reads `startHour`, tomorrow at the earliest. */
function nextMorning(from: Date, timezone: string, startHour: number): Date {
  return atLocalHour(new Date(from.getTime() + DAY_MS), timezone, startHour)
}

/**
 * Moves an instant into the sending window.
 *
 * Before the start hour it waits for it the same day; past 17:59 it waits for
 * the next morning. Mirrors what the planner does, so what the interface
 * promises and what the worker executes are the same rule read twice.
 */
function insideWindow(at: Date, timezone: string, startHour: number): Date {
  const hour = localHour(at, timezone)

  if (hour < startHour) {
    return atLocalHour(at, timezone, startHour)
  }

  return hour > LAST_SEND_HOUR ? nextMorning(at, timezone, startHour) : at
}

function nextSendAt(input: ScheduleInput): Date {
  const { now, timezone, startHour } = input

  if (input.sentLast24h >= input.mailsPerDay && input.oldestSendInWindowAt) {
    // The day's pace is spent. Sending resumes as the oldest send leaves the
    // window — held back again if that falls outside the sending hours.
    const frees = new Date(input.oldestSendInWindowAt.getTime() + DAY_MS)
    return insideWindow(frees, timezone, startHour)
  }

  if (input.lastSentAt) {
    return insideWindow(
      new Date(Math.max(now.getTime(), input.lastSentAt.getTime() + input.pauseMs)),
      timezone,
      startHour,
    )
  }

  return insideWindow(now, timezone, startHour)
}

export function estimateSchedule(input: ScheduleInput): ScheduleEstimate {
  const sending = input.status === 'running' || input.status === 'scheduled'

  if (!sending || input.pending === 0 || input.mailsPerDay <= 0) {
    return { nextSendAt: null, estimatedEndAt: null }
  }

  const next = nextSendAt(input)
  const gap = input.pauseMs * AVERAGE_GAP_FACTOR
  const leftToday = input.mailsPerDay - input.sentLast24h
  const firstBatch = Math.min(
    input.pending,
    leftToday > 0 ? leftToday : input.mailsPerDay,
  )
  const rest = input.pending - firstBatch

  if (rest === 0) {
    return {
      nextSendAt: next,
      estimatedEndAt: new Date(next.getTime() + (firstBatch - 1) * gap),
    }
  }

  const extraDays = Math.ceil(rest / input.mailsPerDay)
  const lastBatch = rest - (extraDays - 1) * input.mailsPerDay
  const lastDayStart = atLocalHour(
    new Date(next.getTime() + extraDays * DAY_MS),
    input.timezone,
    input.startHour,
  )

  return {
    nextSendAt: next,
    estimatedEndAt: new Date(lastDayStart.getTime() + (lastBatch - 1) * gap),
  }
}
