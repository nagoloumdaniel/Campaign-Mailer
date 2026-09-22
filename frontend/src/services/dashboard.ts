import { api } from './api'
import type { CampaignStatus } from './campaigns'

export interface UpcomingSend {
  campaignId: string
  name: string
  status: CampaignStatus
  pending: number
  /** ISO instant of the campaign's last send: where the countdown starts from. */
  lastSentAt: string | null
  /** ISO instant, or null when nobody is left to send to. */
  nextSendAt: string | null
  estimatedEndAt: string | null
}

export interface Dashboard {
  campaigns: {
    total: number
    byStatus: Record<CampaignStatus, number>
  }
  account: {
    /** Messages this account sent over the last 24 hours, across every campaign. */
    sentLast24h: number
    dailyLimit: number
    remaining: number
    /** Sends per calendar day over the last two weeks, oldest first, zero-filled. */
    perDay: { day: string; sent: number }[]
  }
  /** Scheduled and running campaigns, soonest next send first. */
  upcoming: UpcomingSend[]
}

export const dashboardApi = {
  // The browser's zone, so a send at 00:30 lands on the day the reader lived it.
  get: () =>
    api
      .get<{ dashboard: Dashboard }>(
        `/dashboard?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      )
      .then((r) => r.dashboard),
}
