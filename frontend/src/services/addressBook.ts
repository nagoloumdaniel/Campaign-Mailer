import { api } from './api'
import type { CampaignStatus, CampaignType } from './campaigns'
import type { ContactStatus } from './contacts'

/**
 * The account's address book: every contact of every campaign
 * (backend/src/services/addressBook.ts).
 */

export type ContactSource = 'csv' | 'manual' | 'mailfind'

export type AddressBookSort =
  'company' | 'name' | 'email' | 'campaign' | 'status' | 'created'

export interface BookContact {
  id: string
  email: string
  contactName: string | null
  companyName: string | null
  salutation: string | null
  status: ContactStatus
  source: ContactSource
  createdAt: string
  sentAt: string | null
  campaign: { id: string; name: string; status: CampaignStatus; type: CampaignType }
}

export interface AddressBookQuery {
  search?: string | undefined
  status?: ContactStatus | undefined
  source?: ContactSource | undefined
  campaignId?: string | undefined
  /** One row per address, the most recent, rather than one per campaign. */
  unique?: boolean | undefined
  /** Leaves out the addresses this campaign already holds. */
  excludeCampaignId?: string | undefined
  sort: AddressBookSort
  order: 'asc' | 'desc'
  limit: number
  offset: number
}

export interface ContactFields {
  email: string
  contact_name?: string
  company_name?: string
  salutation?: string
}

const SOURCE_LABELS: Record<ContactSource, string> = {
  csv: 'Import CSV',
  manual: 'Ajout manuel',
  mailfind: 'MailFind',
}

export function sourceLabel(source: ContactSource): string {
  return SOURCE_LABELS[source]
}

export const CONTACT_SOURCES = Object.keys(SOURCE_LABELS) as ContactSource[]

type Filters = Omit<AddressBookQuery, 'limit' | 'offset'>

function filterParams(query: Filters): URLSearchParams {
  const params = new URLSearchParams({ sort: query.sort, order: query.order })

  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.source) params.set('source', query.source)
  if (query.campaignId) params.set('campaign_id', query.campaignId)
  if (query.unique) params.set('unique', 'true')
  if (query.excludeCampaignId) params.set('exclude_campaign_id', query.excludeCampaignId)

  return params
}

function queryString(query: AddressBookQuery): string {
  const params = filterParams(query)
  params.set('limit', String(query.limit))
  params.set('offset', String(query.offset))
  return params.toString()
}

export const addressBookApi = {
  list: (query: AddressBookQuery) =>
    api.get<{ contacts: BookContact[]; total: number }>(
      `/contacts?${queryString(query)}`,
    ),

  create: (campaignId: string, fields: ContactFields) =>
    api
      .post<{ contact: BookContact }>('/contacts', { campaign_id: campaignId, ...fields })
      .then((r) => r.contact),

  update: (id: string, fields: ContactFields) =>
    api.patch<{ contact: BookContact }>(`/contacts/${id}`, fields).then((r) => r.contact),

  remove: (id: string) => api.delete(`/contacts/${id}`),

  /** A plain link: the browser downloads, the session cookie rides along. */
  exportUrl: (filters: Filters) => {
    const params = filterParams(filters)
    params.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
    return `/api/contacts/export?${params.toString()}`
  },

  /**
   * Copies contacts of the address book into a draft campaign, server-side.
   * An address the campaign already holds is skipped, not doubled.
   */
  copyToCampaign: (campaignId: string, contactIds: string[]) =>
    api.post<{ imported: number }>('/contacts/copy', {
      campaign_id: campaignId,
      contact_ids: contactIds,
    }),
}
