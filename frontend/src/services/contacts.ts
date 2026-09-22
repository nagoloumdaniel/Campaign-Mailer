import { api } from './api'

export type ContactStatus = 'pending' | 'sent' | 'failed' | 'ignored'

export interface Contact {
  id: string
  email: string
  contactName: string | null
  companyName: string | null
  salutation: string | null
  status: ContactStatus
  errorMessage: string | null
  attempts: number
  sentAt: string | null
}

export type RejectionReason = 'invalid_email' | 'duplicate_in_file' | 'already_imported'

export interface RejectedRow {
  line: number
  email: string
  reason: RejectionReason
}

export interface ImportReport {
  read: number
  imported: number
  /** Into the contacts page only: addresses already there, whose blanks were filled. */
  known?: number
  rejected: RejectedRow[]
}

/** One row as the server expects it: already mapped to the four fields. */
export interface MappedRow {
  email: string
  contact_name?: string
  company_name?: string
  salutation?: string
}

/** Matches IMPORT_BATCH_LIMIT on the server. A larger file is sent in slices. */
export const IMPORT_BATCH_LIMIT = 2000

export const contactsApi = {
  list: (
    campaignId: string,
    query: {
      status?: ContactStatus
      search?: string
      limit?: number
      offset?: number
    } = {},
  ) => {
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value))
      }
    }

    const suffix = params.toString() ? `?${params.toString()}` : ''

    return api.get<{ contacts: Contact[]; total: number; limit: number; offset: number }>(
      `/campaigns/${campaignId}/contacts${suffix}`,
    )
  },

  /**
   * Sends the rows in slices and merges the reports.
   *
   * The server caps a batch so one request cannot hold its pool. Splitting
   * here keeps that invisible to the user, who chose a file, not a batch size.
   */
  async import(
    campaignId: string,
    rows: MappedRow[],
    options: {
      firstLine?: number
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<ImportReport> {
    const firstLine = options.firstLine ?? 2
    const merged: ImportReport = { read: 0, imported: 0, rejected: [] }

    for (let start = 0; start < rows.length; start += IMPORT_BATCH_LIMIT) {
      const slice = rows.slice(start, start + IMPORT_BATCH_LIMIT)

      const { report } = await api.post<{ report: ImportReport }>(
        `/campaigns/${campaignId}/contacts/import`,
        { rows: slice, first_line: firstLine + start },
      )

      merged.read += report.read
      merged.imported += report.imported
      merged.rejected.push(...report.rejected)
      options.onProgress?.(Math.min(start + slice.length, rows.length), rows.length)
    }

    return merged
  },

  add: (campaignId: string, contact: MappedRow) =>
    api
      .post<{ contact: Contact }>(`/campaigns/${campaignId}/contacts`, contact)
      .then((r) => r.contact),

  setStatus: (campaignId: string, contactId: string, status: 'pending' | 'ignored') =>
    api
      .patch<{ contact: Contact }>(`/campaigns/${campaignId}/contacts/${contactId}`, {
        status,
      })
      .then((r) => r.contact),

  remove: (campaignId: string, contactId: string) =>
    api.delete(`/campaigns/${campaignId}/contacts/${contactId}`),
}

const REASON_LABELS: Record<RejectionReason, string> = {
  invalid_email: 'Adresse invalide',
  duplicate_in_file: 'Doublon dans le fichier',
  already_imported: 'Déjà dans la campagne',
}

export function reasonLabel(reason: RejectionReason): string {
  return REASON_LABELS[reason]
}

const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  pending: 'En attente',
  sent: 'Envoyé',
  failed: 'En erreur',
  ignored: 'Ignoré',
}

export function contactStatusLabel(status: ContactStatus): string {
  return CONTACT_STATUS_LABELS[status]
}
