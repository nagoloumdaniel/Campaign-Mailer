import { api } from './api'

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed'

/**
 * What a campaign is for. Mirrors the server enum; it drives no send rule, it
 * groups the history and tells a follow-up apart from the run it came from.
 */
export type CampaignType =
  'prospection' | 'relance' | 'marketing' | 'alternance' | 'autre'

export interface CampaignAttachment {
  id: string
  name: string
  /** Null for a file stored before sizes were recorded. */
  size: number | null
  contentType: string
  createdAt: string
}

export interface Campaign {
  id: string
  name: string
  type: CampaignType
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  status: CampaignStatus
  totalContacts: number
  sentCount: number
  errorCount: number
  mailsPerDay: number
  startHour: number
  pauseMs: number
  timezone: string
  createdAt: string
  updatedAt: string
  scheduledAt: string | null
  /** The day and hour the launch was scheduled for; null means as soon as possible. */
  sendAfter: string | null
  startedAt: string | null
  completedAt: string | null
  /** Present on a single campaign, not in the list. */
  attachments?: CampaignAttachment[]
  /** Present on a single campaign, not in the list. */
  sending?: {
    accountSentLast24h: number
    accountDailyLimit: number | null
  }
}

/** One day of sending, on the campaign's own calendar. */
export interface DaySends {
  /** YYYY-MM-DD in the campaign's time zone. */
  day: string
  sent: number
  failed: number
}

export interface CampaignStats {
  total: number
  sent: number
  failed: number
  pending: number
  ignored: number
  /** Failed over attempted; null before anything was attempted. */
  errorRate: number | null
  lastSentAt: string | null
  nextSendAt: string | null
  /** A lower bound: another campaign of the account may spend the same ceiling. */
  estimatedEndAt: string | null
  perDay: DaySends[]
}

export interface StarterTemplate {
  id: string
  name: string
  description: string
  subject: string
  bodyText: string
  bodyHtml: string
}

export interface Preview {
  subject: string
  bodyHtml: string
  bodyText: string
  contact: Record<string, string | null>
}

/** Mirrors the server's list, fetched rather than duplicated so the two cannot drift. */
export interface TemplateCatalogue {
  templates: StarterTemplate[]
  variables: string[]
}

export const campaignsApi = {
  list: () => api.get<{ campaigns: Campaign[] }>('/campaigns').then((r) => r.campaigns),

  get: (id: string) =>
    api.get<{ campaign: Campaign }>(`/campaigns/${id}`).then((r) => r.campaign),

  create: (input: {
    name: string
    type?: CampaignType
    subject?: string
    body_html?: string
    body_text?: string
  }) =>
    api
      // The computer's zone, never asked: the campaign sends on the user's clock.
      .post<{ campaign: Campaign }>('/campaigns', {
        ...input,
        timezone: browserTimeZone(),
      })
      .then((r) => r.campaign),

  /**
   * A follow-up built from contacts already written to. The server copies
   * them, so nothing has to be exported and imported back.
   */
  followUp: (input: { name: string; contact_ids: string[]; type?: CampaignType }) =>
    api.post<{ campaign: Campaign; imported: number }>('/campaigns/follow-up', input),

  update: (id: string, patch: Record<string, unknown>) =>
    api.patch<{ campaign: Campaign }>(`/campaigns/${id}`, patch).then((r) => r.campaign),

  remove: (id: string) => api.delete(`/campaigns/${id}`),

  preview: (
    id: string,
    source: { contact_id?: string; contact?: Record<string, string> },
  ) =>
    api
      .post<{ preview: Preview }>(`/campaigns/${id}/preview`, source)
      .then((r) => r.preview),

  templates: () => api.get<TemplateCatalogue>('/templates'),

  /**
   * Launches now, or at the day and hour chosen (an ISO instant). The
   * browser's zone goes with it: the campaign sends on the user's clock, and
   * the zone is never something to set by hand.
   */
  start: (id: string, sendAfter: string | null = null) =>
    api
      .post<{ campaign: Campaign }>(`/campaigns/${id}/start`, {
        timezone: browserTimeZone(),
        ...(sendAfter ? { send_after: sendAfter } : {}),
      })
      .then((r) => r.campaign),

  pause: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/pause`).then((r) => r.campaign),

  resume: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/resume`).then((r) => r.campaign),

  stats: (id: string) =>
    api.get<{ stats: CampaignStats }>(`/campaigns/${id}/stats`).then((r) => r.stats),

  /**
   * A plain link, not a fetch: the browser handles the download, the session
   * cookie rides along, and nothing is held in memory on this side.
   */
  logsExportUrl: (id: string) => `/api/campaigns/${id}/logs/export`,
}

export interface SendSchedule {
  remaining: number
  days: number
  /** The last day messages go out, counted from today. */
  lastDay: Date
  /** Roughly how long one day's sending takes, pauses included. */
  minutesPerDay: number
}

/**
 * What launching commits the user to, in days and minutes.
 *
 * An estimate, and said to be one: it counts from today in the browser's
 * calendar, and ignores the account ceiling another campaign may be spending.
 * A campaign started after its start hour begins at once, so today is always
 * the first day.
 */
export function estimateSchedule(
  campaign: Pick<
    Campaign,
    'totalContacts' | 'sentCount' | 'errorCount' | 'mailsPerDay' | 'pauseMs'
  >,
  today: Date = new Date(),
): SendSchedule | null {
  const remaining = campaign.totalContacts - campaign.sentCount - campaign.errorCount

  if (remaining <= 0 || campaign.mailsPerDay <= 0) {
    return null
  }

  const days = Math.ceil(remaining / campaign.mailsPerDay)
  const lastDay = new Date(today)
  lastDay.setDate(lastDay.getDate() + days - 1)

  const perDay = Math.min(remaining, campaign.mailsPerDay)
  // The average jitter is ten percent on top of the pause.
  const minutesPerDay = Math.ceil((perDay * campaign.pauseMs * 1.1) / 60_000)

  return { remaining, days, lastDay, minutesPerDay }
}

const TYPE_LABELS: Record<CampaignType, string> = {
  prospection: 'Prospection',
  relance: 'Relance',
  marketing: 'Marketing',
  alternance: 'Alternance / stage',
  autre: 'Personnalisée',
}

export const CAMPAIGN_TYPES: CampaignType[] = [
  'prospection',
  'relance',
  'alternance',
  'marketing',
  'autre',
]

export function campaignTypeLabel(type: CampaignType): string {
  return TYPE_LABELS[type]
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Brouillon',
  scheduled: 'Programmée',
  running: 'En cours',
  paused: 'En pause',
  completed: 'Terminée',
}

export function statusLabel(status: CampaignStatus): string {
  return STATUS_LABELS[status]
}

/**
 * Only a draft can be edited. Mirrors the server rule so the interface does not
 * offer an action the API will refuse with a 409.
 */
export function isEditable(status: CampaignStatus): boolean {
  return status === 'draft'
}

/**
 * The pace stays editable until the campaign is finished, a running one
 * included: that is what lets one daily allowance be shared between several
 * live campaigns without pausing them all first. Mirrors the server rule, so
 * the interface never offers an action the API refuses.
 */
export function canEditCadence(status: CampaignStatus): boolean {
  return status !== 'completed'
}

/** A campaign that has finished, and whose page is a record rather than a desk. */
export function isFinished(status: CampaignStatus): boolean {
  return status === 'completed'
}

/** Scheduled, running or paused: it has left the desk and has work left. */
export function isActive(status: CampaignStatus): boolean {
  return status === 'scheduled' || status === 'running' || status === 'paused'
}

/** What is left to attempt, never negative. */
export function remainingOf(
  campaign: Pick<Campaign, 'totalContacts' | 'sentCount' | 'errorCount'>,
): number {
  return Math.max(0, campaign.totalContacts - campaign.sentCount - campaign.errorCount)
}

/**
 * True when everything left to send fits under the campaign's daily pace.
 *
 * Then the pace never holds anything back, and a panel about "46 e-mails par
 * jour" describes a limit the campaign will not meet: the interface leaves it
 * out. It comes back by itself the moment an import makes the list longer than
 * a day. The account's own 450 ceiling still applies, and is still enforced by
 * the server whatever this says.
 */
export function fitsInOneDay(
  campaign: Pick<Campaign, 'totalContacts' | 'sentCount' | 'errorCount' | 'mailsPerDay'>,
): boolean {
  return remainingOf(campaign) <= campaign.mailsPerDay
}

/**
 * The sending window, on the campaign's own clock. Mirrors FIRST_SEND_HOUR and
 * LAST_SEND_HOUR on the server: Monday to Saturday, nothing before 09:00 or
 * after 18:59 (owner's decision, 22 September 2026). A campaign launched after
 * the window, or on a Sunday, starts at the next opening.
 */
export const FIRST_SEND_HOUR = 9
export const LAST_SEND_HOUR = 18

/**
 * The window as a person reads it.
 *
 * 18 is the last hour a send may *begin*, so the window runs to the end of
 * that hour: "19 h" is when it closes, and nothing starts at 19:00.
 */
export const SEND_WINDOW_LABEL = 'du lundi au samedi, de 9 h à 19 h'

/** Thirty seconds between two sends, plus jitter: the server's, not a setting. */
export const PAUSE_MS = 30_000

/** The zone the browser runs in: where the user is, and the campaign's clock. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'Europe/Paris'
  }
}

/** Monday to Saturday, 09:00 to 18:59, on the browser's clock. */
export function insideSendingWindow(at: Date): boolean {
  const hour = at.getHours()
  return at.getDay() !== 0 && hour >= FIRST_SEND_HOUR && hour <= LAST_SEND_HOUR
}

/** The next opening of the window at or after `from`, on the browser's clock. */
export function nextOpening(from: Date): Date {
  const at = new Date(from)

  for (let step = 0; step < 8; step += 1) {
    const opens = new Date(at)
    opens.setHours(FIRST_SEND_HOUR, 0, 0, 0)

    if (opens.getTime() >= from.getTime() && opens.getDay() !== 0) {
      return opens
    }

    at.setDate(at.getDate() + 1)
  }

  return at
}
