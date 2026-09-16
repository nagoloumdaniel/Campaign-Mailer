import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { ApiError } from '@/services/api'
import type { CampaignStatus } from '@/services/campaigns'
import {
  contactStatusLabel,
  contactsApi,
  type Contact,
  type ContactStatus,
} from '@/services/contacts'
import { formatNumber } from '@/services/format'

import { ImportDialog } from './ImportDialog'

/**
 * The campaign's contacts, kept deliberately small.
 *
 * Three rows at a time. A campaign holds hundreds of them and a table of
 * hundreds pushes everything else — the message, the pace, the send controls
 * — below the fold, which is where they stop being read. Three rows plus a
 * search and a pager say "here is the list, and here is how to find a row in
 * it" in the height of a paragraph, and that is all this panel is for.
 *
 * On a finished campaign the actions disappear and the status column goes
 * with them: the list becomes a record of who was written to, which is the
 * only question left to ask of it.
 */

const PAGE = 3

const STATUS_OPTIONS: { value: ContactStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: contactStatusLabel('pending') },
  { value: 'sent', label: contactStatusLabel('sent') },
  { value: 'failed', label: contactStatusLabel('failed') },
  { value: 'ignored', label: contactStatusLabel('ignored') },
]

const STATUS_TONE: Record<ContactStatus, string> = {
  pending: 'text-ink-muted',
  sent: 'text-success',
  failed: 'text-danger',
  ignored: 'text-ink-subtle',
}

export function ContactsSection({
  campaignId,
  campaignStatus,
  totalContacts,
  editable,
  reloadKey,
  onChanged,
}: {
  campaignId: string
  campaignStatus: CampaignStatus
  totalContacts: number
  /** A draft accepts imports and row actions; anything later does not. */
  editable: boolean
  /** Changes when an import lands, so the table reloads without a prop drill. */
  reloadKey: number
  onChanged: () => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState<ContactStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [importing, setImporting] = useState(false)

  const finished = campaignStatus === 'completed'

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)

    try {
      const result = await contactsApi.list(campaignId, {
        ...(status === 'all' ? {} : { status }),
        ...(search ? { search } : {}),
        limit: PAGE,
        offset,
      })

      setContacts(result.contacts)
      setTotal(result.total)
    } catch {
      // Said in place rather than in a toast: left empty, the table would read
      // "no contacts, import a file", and the user would import them twice.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [campaignId, status, search, offset])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load, reloadKey])

  /**
   * Every filter goes back to the first page.
   *
   * Done in the handler rather than in an effect watching the filters: an
   * effect would fetch page three of the new filter once — usually empty —
   * before correcting itself, which costs a request and shows a flash of
   * "aucun résultat".
   */
  function refine(apply: () => void) {
    apply()
    setOffset(0)
  }

  async function act(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      toast.success(message)
      await load()
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’action a échoué.')
    }
  }

  const filtering = search !== '' || status !== 'all'

  return (
    <Card as="section" aria-labelledby="contacts-heading" className="p-5">
      <CardHeader
        id="contacts-heading"
        title={
          <>
            Contacts{' '}
            <span className="tabular font-normal text-ink-muted">
              ({formatNumber(totalContacts)})
            </span>
          </>
        }
        description={
          editable
            ? 'Importez un CSV : les contacts s’ajoutent à la suite des précédents.'
            : 'La liste des destinataires de cette campagne.'
        }
        action={
          editable && (
            <Button
              variant="secondary"
              size="sm"
              icon="upload"
              onClick={() => {
                setImporting(true)
              }}
            >
              Importer
            </Button>
          )
        }
      />

      {totalContacts === 0 && !filtering ? (
        <EmptyState
          compact
          icon="users"
          title="Aucun contact importé"
          description={
            editable
              ? 'Importez un fichier CSV contenant au moins une colonne d’adresses e-mail.'
              : 'Cette campagne n’a jamais reçu de contacts.'
          }
          className="mt-4"
          action={
            editable && (
              <Button
                variant="primary"
                icon="upload"
                onClick={() => {
                  setImporting(true)
                }}
              >
                Importer un fichier CSV
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(value) => {
                refine(() => {
                  setSearch(value)
                })
              }}
              placeholder="Rechercher un contact…"
              label="Rechercher un contact"
              className="min-w-0 flex-1"
            />
            {!finished && (
              <Select
                value={status}
                options={STATUS_OPTIONS}
                onChange={(value) => {
                  refine(() => {
                    setStatus(value)
                  })
                }}
                label="Filtrer par statut"
                labelHidden
                align="end"
                className="w-36"
              />
            )}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface-2 text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium max-sm:hidden">Entreprise</th>
                  {!finished && <th className="px-3 py-2 font-medium">Statut</th>}
                  {editable && (
                    <th className="px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>

              <tbody>
                {loading &&
                  Array.from({ length: PAGE }, (_, index) => (
                    <tr
                      key={`skeleton-${String(index)}`}
                      className="border-t border-border"
                    >
                      <td className="px-3 py-2.5">
                        <Skeleton className="h-3 w-40 max-w-full" />
                      </td>
                      <td className="px-3 py-2.5 max-sm:hidden">
                        <Skeleton className="h-3 w-24" />
                      </td>
                      {!finished && (
                        <td className="px-3 py-2.5">
                          <Skeleton className="h-3 w-16" />
                        </td>
                      )}
                      {editable && <td />}
                    </tr>
                  ))}

                {!loading &&
                  contacts.map((contact) => (
                    <tr key={contact.id} className="border-t border-border">
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-medium">
                          {contact.contactName ?? contact.email}
                        </span>
                        {contact.contactName && (
                          <span className="block truncate text-xs text-ink-muted">
                            {contact.email}
                          </span>
                        )}
                        {contact.errorMessage && (
                          // The reason a send failed belongs beside the
                          // address, not in a detail panel nobody opens.
                          <span className="mt-0.5 block truncate text-xs text-danger">
                            {contact.errorMessage}
                          </span>
                        )}
                      </td>

                      <td className="max-w-40 truncate px-3 py-2.5 text-ink-muted max-sm:hidden">
                        {contact.companyName ?? '—'}
                      </td>

                      {!finished && (
                        <td
                          className={`px-3 py-2.5 text-xs whitespace-nowrap ${STATUS_TONE[contact.status]}`}
                        >
                          {contactStatusLabel(contact.status)}
                        </td>
                      )}

                      {editable && (
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {(contact.status === 'pending' ||
                            contact.status === 'ignored') && (
                            <IconButton
                              size="sm"
                              icon={contact.status === 'ignored' ? 'refresh' : 'pause'}
                              label={
                                contact.status === 'ignored'
                                  ? `Réactiver ${contact.email}`
                                  : `Ignorer ${contact.email}`
                              }
                              onClick={() =>
                                void act(
                                  () =>
                                    contactsApi.setStatus(
                                      campaignId,
                                      contact.id,
                                      contact.status === 'ignored'
                                        ? 'pending'
                                        : 'ignored',
                                    ),
                                  contact.status === 'ignored'
                                    ? 'Contact remis en attente.'
                                    : 'Contact ignoré.',
                                )
                              }
                            />
                          )}
                          <IconButton
                            size="sm"
                            icon="trash"
                            label={`Supprimer ${contact.email}`}
                            onClick={() =>
                              void act(
                                () => contactsApi.remove(campaignId, contact.id),
                                'Contact supprimé.',
                              )
                            }
                            className="hover:text-danger"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>

            {!loading && failed && (
              <div className="border-t border-border p-3">
                <ErrorState
                  compact
                  title="Les contacts n’ont pas pu être chargés"
                  onRetry={() => void load()}
                />
              </div>
            )}

            {!loading && !failed && contacts.length === 0 && (
              <p className="flex items-center justify-center gap-2 border-t border-border px-4 py-8 text-center text-[13px] text-ink-muted">
                <Icon name="search" size={15} />
                Aucun contact ne correspond à votre recherche.
              </p>
            )}
          </div>

          <Pagination
            offset={offset}
            limit={PAGE}
            total={total}
            onChange={setOffset}
            label="Pagination des contacts"
            className="mt-3"
          />
        </>
      )}

      <ImportDialog
        open={importing}
        campaignId={campaignId}
        existingCount={totalContacts}
        onClose={() => {
          setImporting(false)
        }}
        onImported={() => {
          onChanged()
          void load()
        }}
      />
    </Card>
  )
}
