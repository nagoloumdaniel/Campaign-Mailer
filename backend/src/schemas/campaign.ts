import { z } from 'zod'

/**
 * Payload shapes for the campaign routes.
 *
 * The bounds mirror the CHECK constraints in the initial migration on purpose.
 * The database is the boundary a script or a manual UPDATE cannot walk around;
 * these exist so a user gets a readable message instead of a constraint
 * violation, and so both say the same thing.
 */

/** Long enough for a real newsletter, short enough that a paste cannot fill the table. */
const MAX_BODY = 100_000
const MAX_SUBJECT = 500
const MAX_NAME = 200

/**
 * Google allows a personal Gmail account 500 messages over a rolling 24 hours.
 * A campaign may not ask for more than the application's own account ceiling,
 * 450, so a daily batch that Gmail would refuse cannot even be saved. Workspace
 * accounts, allowed more, are a post-MVP item.
 */
const MIN_MAILS_PER_DAY = 1
export const MAX_MAILS_PER_DAY = 450

/**
 * Ten seconds at least between two sends, thirty by default. A burst is what
 * gets an account flagged; the pace of a person writing is what does not.
 */
export const MIN_PAUSE_MS = 10_000
export const DEFAULT_PAUSE_MS = 30_000
const MAX_PAUSE_MS = 600_000

/**
 * An IANA zone name, and nothing else.
 *
 * Intl accepts a fixed offset such as `+02:00` as a valid time zone, and that
 * would quietly break the campaign: an offset does not follow daylight saving,
 * so "send at 9 in the morning" would go out at 8 or at 10 for half the year.
 * Only a Region/City name, or UTC, carries the rules.
 *
 * The name is then checked against the runtime's own database rather than a
 * regular expression, so a plausible but non-existent city is refused.
 */
const ZONE_SEGMENT = /^[A-Za-z0-9_+-]{1,20}$/

function looksLikeZoneName(value: string): boolean {
  if (value === 'UTC') {
    return true
  }

  // Split and check each part, rather than one expression with a quantifier
  // inside a quantifier. That shape is what catastrophic backtracking is built
  // from, and here it buys nothing.
  const parts = value.split('/')

  return (
    parts.length >= 2 &&
    parts.length <= 3 &&
    parts.every((part) => ZONE_SEGMENT.test(part))
  )
}

function isTimeZone(value: string): boolean {
  if (!looksLikeZoneName(value)) {
    return false
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: 'Unknown time zone' })

/**
 * Office hours, on the campaign's own clock.
 *
 * Nothing goes out before 10:00 or after 17:59. The rule is about how the
 * message is received, not about Gmail's limits: a candidature that lands at
 * three in the morning reads as automated. `LAST` is the last hour a send may
 * *begin*, so the window closes at the end of that hour.
 */
export const FIRST_SEND_HOUR = 10
export const LAST_SEND_HOUR = 17

const cadence = {
  mails_per_day: z.number().int().min(MIN_MAILS_PER_DAY).max(MAX_MAILS_PER_DAY),
  start_hour: z.number().int().min(FIRST_SEND_HOUR).max(LAST_SEND_HOUR),
  pause_ms: z.number().int().min(MIN_PAUSE_MS).max(MAX_PAUSE_MS),
  timezone,
}

/**
 * What a campaign is for. Drives no send rule; it groups the history and tells
 * a follow-up apart from the run it came from.
 */
export const CAMPAIGN_TYPES = [
  'prospection',
  'relance',
  'marketing',
  'alternance',
  'autre',
] as const

export type CampaignType = (typeof CAMPAIGN_TYPES)[number]

const content = {
  // Trimmed before length is judged, so a name of spaces is empty, not valid.
  name: z.string().trim().min(1).max(MAX_NAME),
  subject: z.string().trim().max(MAX_SUBJECT),
  body_html: z.string().max(MAX_BODY),
  body_text: z.string().max(MAX_BODY),
}

export const createCampaignSchema = z
  .object({
    name: content.name,
    type: z.enum(CAMPAIGN_TYPES).optional(),
    subject: content.subject.optional(),
    body_html: content.body_html.optional(),
    body_text: content.body_text.optional(),
    mails_per_day: cadence.mails_per_day.optional(),
    start_hour: cadence.start_hour.optional(),
    pause_ms: cadence.pause_ms.optional(),
    timezone: cadence.timezone.optional(),
  })
  // Unknown keys are refused rather than dropped. A typo in a field name would
  // otherwise be accepted in silence and the value never stored.
  .strict()

/**
 * Every field optional, but at least one present: an empty PATCH is almost
 * always a bug in the caller, and answering 200 to it hides that.
 */
export const updateCampaignSchema = createCampaignSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No field to update',
  })

/**
 * Which of a payload's fields are content, and which are cadence.
 *
 * `type` is in neither on purpose: it is a label on the campaign, not part of
 * the message or of the pace, so it stays editable in every state. Filing a
 * finished run under the right category is exactly the sort of tidying a user
 * does afterwards.
 */
export const CONTENT_FIELDS = ['name', 'subject', 'body_html', 'body_text'] as const
export const CADENCE_FIELDS = [
  'mails_per_day',
  'start_hour',
  'pause_ms',
  'timezone',
] as const

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>

export const previewSchema = z
  .object({
    // A preview may target a stored contact, or made-up values when no contact
    // has been imported yet.
    contact_id: z.uuid().optional(),
    contact: z
      .object({
        email: z.string().max(320).optional(),
        contact_name: z.string().max(200).optional(),
        company_name: z.string().max(200).optional(),
        salutation: z.string().max(100).optional(),
      })
      .optional(),
  })
  .strict()

export type PreviewInput = z.infer<typeof previewSchema>

/**
 * A follow-up campaign, built from contacts already written to.
 *
 * The ids come from the history, so they point at contacts of the user's own
 * campaigns; the route checks that ownership rather than trusting it. The cap
 * is the import batch limit: a larger selection is an import, not a follow-up.
 */
export const followUpSchema = z
  .object({
    name: content.name,
    contact_ids: z.array(z.uuid()).min(1).max(2000),
    type: z.enum(CAMPAIGN_TYPES).optional(),
  })
  .strict()

export type FollowUpInput = z.infer<typeof followUpSchema>
