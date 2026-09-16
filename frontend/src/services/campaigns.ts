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
  }) => api.post<{ campaign: Campaign }>('/campaigns', input).then((r) => r.campaign),

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

  start: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/start`).then((r) => r.campaign),

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
 * Office hours, on the campaign's own clock. Mirrors FIRST_SEND_HOUR and
 * LAST_SEND_HOUR on the server: nothing goes out before 10:00 or after 17:59,
 * and a campaign launched after the window starts the next morning.
 */
export const FIRST_SEND_HOUR = 10
export const LAST_SEND_HOUR = 17

/**
 * The window as a person reads it.
 *
 * 17 is the last hour a send may *begin*, so the window runs to the end of
 * that hour. Written out once here rather than computed at each call site as
 * `LAST_SEND_HOUR + 1`, which read as "jusqu'à 18:00" and made users think
 * they could choose 18:00 as a start hour.
 */
export const SEND_WINDOW_LABEL = '10:00–17:59'
