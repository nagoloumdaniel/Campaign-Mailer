/**
 * Deciding which contacts go out, and when.
 *
 * Pure on purpose: no database, no queue, no clock of its own. Every rule that
 * decides how many messages a user's account sends in a day lives here, where
 * a test can pin it without Redis or Postgres.
 */

/** Up to twenty percent added to each pause. A perfectly regular interval is a signature. */
const JITTER = 0.2

/**
 * The last hour of the day a send may begin, on the campaign's wall clock.
 *
 * Mirrors LAST_SEND_HOUR in schemas/campaign.ts, which is what a user may
 * choose as a start hour. Kept as a number here rather than imported, so this
 * module stays free of the HTTP layer's schemas.
 *
 * The window closes at the end of that hour, so 17 means "nothing starts at
 * 18:00 or later".
 */
export const LAST_SEND_HOUR = 17

/** The instant the window closes: the first millisecond of hour 18. */
const WINDOW_END_HOUR = LAST_SEND_HOUR + 1

export interface PlanInput {
  now: Date
  /** IANA zone. The start hour is the user's morning, not the server's. */
  timezone: string
  startHour: number
  mailsPerDay: number
  pauseMs: number
  /** What this campaign sent over the last 24 hours. */
  sentByCampaign: number
  /** What the account sent over the last 24 hours, across every campaign. */
  sentByAccount: number
  accountLimit: number
  /** Oldest first. The plan takes from the front. */
  pendingContactIds: readonly string[]
  /** Injected so a test can pin the jitter. Defaults to Math.random. */
  random?: (() => number) | undefined
}

export interface PlannedSend {
  contactId: string
  /** From `now`. */
  delayMs: number
}

export type PlanOutcome =
  | { kind: 'planned'; sends: PlannedSend[] }
  | { kind: 'before_start_hour' }
  /** Past 17:59 on the campaign's clock. The next pass plans tomorrow morning. */
  | { kind: 'after_send_window' }
  | { kind: 'campaign_quota_reached' }
  | { kind: 'account_quota_reached' }
  | { kind: 'nothing_pending' }

/** The hour on the wall clock in `timezone`, 0 to 23, daylight saving included. */
export function localHour(now: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .find((part) => part.type === 'hour')?.value

  return Number(hour)
}

/**
 * How long the sending window still has to run, in milliseconds, or 0 once it
 * has closed.
 *
 * Counted to the start of hour 18 on the campaign's wall clock, minutes and
 * seconds of the current hour taken off. A minute's granularity is plenty: the
 * shortest pause between two sends is ten seconds.
 */
export function windowRemainingMs(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)

  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)

  const elapsed =
    read('hour') * 3_600_000 + read('minute') * 60_000 + read('second') * 1000

  return Math.max(0, WINDOW_END_HOUR * 3_600_000 - elapsed)
}

export function planDay(input: PlanInput): PlanOutcome {
  const hour = localHour(input.now, input.timezone)

  if (hour < input.startHour) {
    return { kind: 'before_start_hour' }
  }

  // Past the window, nothing is queued at all. A campaign launched at 18:30
  // starts the next morning, which is what the interface promised, rather than
  // firing its first message that evening.
  if (hour > LAST_SEND_HOUR) {
    return { kind: 'after_send_window' }
  }

  if (input.pendingContactIds.length === 0) {
    return { kind: 'nothing_pending' }
  }

  const campaignBudget = input.mailsPerDay - input.sentByCampaign
  const accountBudget = input.accountLimit - input.sentByAccount

  // The account ceiling is checked first because it is the one that protects
  // the user's Google account; the campaign's own pace is a preference.
  if (accountBudget <= 0) {
    return { kind: 'account_quota_reached' }
  }

  if (campaignBudget <= 0) {
    return { kind: 'campaign_quota_reached' }
  }

  const random = input.random ?? Math.random
  const budget = Math.min(campaignBudget, accountBudget)
  const remaining = windowRemainingMs(input.now, input.timezone)
  const sends: PlannedSend[] = []
  let delayMs = 0

  for (const contactId of input.pendingContactIds.slice(0, budget)) {
    // A send whose delay lands past 17:59 is not queued: 450 messages thirty
    // seconds apart run nearly four hours, and a plan made at 16:00 would
    // otherwise deliver into the night. The contact stays pending and the next
    // morning's pass takes it, which is the same rule as the daily ceiling.
    if (delayMs >= remaining) {
      break
    }

    sends.push({ contactId, delayMs })
    delayMs += Math.round(input.pauseMs * (1 + random() * JITTER))
  }

  // Everything the budget allowed fell outside the window. Reported as a
  // closed window rather than as an empty plan, so the log says why.
  return sends.length === 0 ? { kind: 'after_send_window' } : { kind: 'planned', sends }
}
