import { api } from './api'
import type { CampaignType } from './campaigns'

/**
 * Everything this account has sent, across every campaign.
 *
 * Read from the send log rather than from the contacts, so a follow-up
 * campaign's recipients are not counted twice against the run they came from
 * — which is exactly the comparison this page exists to make.
 */

export type HistoryOutcome = 'sent' | 'failed'

export interface HistoryEntry {
  id: string
  campaignId: string
  campaignName: string
  campaignType: CampaignType
  subject: string | null
  /** Null once the contact has been deleted; the log line survives it. */
  contactId: string | null
  email: string | null
  contactName: string | null
  companyName: string | null
  outcome: HistoryOutcome
  message: string | null
  sentAt: string
}

export interface HistoryFilters {
  search?: string
  type?: CampaignType
  campaignId?: string
  outcome?: HistoryOutcome
}

export interface HistoryPage {
  history: HistoryEntry[]
  total: number
  /** How many messages per type, whatever type filter is applied. */
  byType: Record<CampaignType, number>
  limit: number
  offset: number
}

function toQuery(
  filters: HistoryFilters,
  paging: { limit?: number; offset?: number } = {},
): string {
  const params = new URLSearchParams()

  if (filters.search) {
    params.set('search', filters.search)
  }
  if (filters.type) {
    params.set('type', filters.type)
  }
  if (filters.campaignId) {
    params.set('campaign_id', filters.campaignId)
  }
  if (filters.outcome) {
    params.set('outcome', filters.outcome)
  }
  if (paging.limit !== undefined) {
    params.set('limit', String(paging.limit))
  }
  if (paging.offset !== undefined) {
    params.set('offset', String(paging.offset))
  }

  // The export prints its dates on the reader's own clock, not the server's.
  params.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)

  return params.toString()
}

export const historyApi = {
  list: (filters: HistoryFilters, paging: { limit: number; offset: number }) =>
    api.get<HistoryPage>(`/history?${toQuery(filters, paging)}`),

  /** A plain link: the browser downloads, the session cookie rides along. */
  exportUrl: (filters: HistoryFilters) => `/api/history/export?${toQuery(filters)}`,
}
