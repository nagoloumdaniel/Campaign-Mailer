import { api } from './api'
import type { MappedRow } from './contacts'

/**
 * The account's address book: one entry per email address, whatever brought
 * it (backend/src/services/addressBook.ts).
 */

export type ContactSource = 'csv' | 'manual' | 'mailfind'

export type AddressBookSort = 'name' | 'email' | 'company' | 'created' | 'source'

export interface BookContact {
  id: string
  email: string
  contactName: string | null
  companyName: string | null
  salutation: string | null
  source: ContactSource
  createdAt: string
}

export interface AddressBookQuery {
  search?: string | undefined
  source?: ContactSource | undefined
  /** Leaves out the addresses this campaign already holds. */
  excludeCampaignId?: string | undefined
  sort: AddressBookSort
  order: 'asc' | 'desc'
  limit: number
  offset: number
}

type Filters = Omit<AddressBookQuery, 'limit' | 'offset'>

const SOURCE_LABELS: Record<ContactSource, string> = {
  csv: 'Import CSV',
  manual: 'Ajout manuel',
  mailfind: 'MailFind',
}

export function sourceLabel(source: ContactSource): string {
  return SOURCE_LABELS[source]
}

export const CONTACT_SOURCES = Object.keys(SOURCE_LABELS) as ContactSource[]

function filterParams(query: Filters): URLSearchParams {
  const params = new URLSearchParams({ sort: query.sort, order: query.order })

  if (query.search) params.set('search', query.search)
  if (query.source) params.set('source', query.source)
  if (query.excludeCampaignId) params.set('exclude_campaign_id', query.excludeCampaignId)

  return params
}

export const addressBookApi = {
  list: (query: AddressBookQuery) => {
    const params = filterParams(query)
    params.set('limit', String(query.limit))
    params.set('offset', String(query.offset))
    return api.get<{ contacts: BookContact[]; total: number }>(
      `/contacts?${params.toString()}`,
    )
  },

  /** The same four fields as adding a contact to a campaign. */
  create: (fields: MappedRow) =>
    api.post<{ contact: BookContact }>('/contacts', fields).then((r) => r.contact),

  update: (id: string, fields: MappedRow) =>
    api.patch<{ contact: BookContact }>(`/contacts/${id}`, fields).then((r) => r.contact),

  remove: (id: string) => api.delete(`/contacts/${id}`),

  /** A plain link: the browser downloads, the session cookie rides along. */
  exportUrl: (filters: Filters) => {
    const params = filterParams(filters)
    params.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
    return `/api/contacts/export?${params.toString()}`
  },

  /**
   * Copies entries of the book into a draft campaign, server-side. An address
   * the campaign already holds is skipped, not doubled.
   */
  copyToCampaign: (campaignId: string, contactIds: string[]) =>
    api.post<{ imported: number }>('/contacts/copy', {
      campaign_id: campaignId,
      contact_ids: contactIds,
    }),
}
