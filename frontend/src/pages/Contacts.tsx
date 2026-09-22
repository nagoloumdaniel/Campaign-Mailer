import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { AddContactDialog } from '@/components/campaign/AddContactDialog'
import { ImportDialog } from '@/components/campaign/ImportDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { HistorySkeleton } from '@/components/skeletons/PageSkeletons'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { AnchorButton, Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  CONTACT_SOURCES,
  addressBookApi,
  sourceLabel,
  type AddressBookSort,
  type BookContact,
  type ContactSource,
} from '@/services/addressBook'
import { ApiError } from '@/services/api'
import {
  CAMPAIGN_TYPES,
  campaignTypeLabel,
  campaignsApi,
  type CampaignType,
} from '@/services/campaigns'
import { countOf, formatDate } from '@/services/format'

/**
 * The account's contacts: one line per email address, whatever brought it (a
 * CSV file, a manual add, MailFind) and whether a campaign uses it or not.
 *
 * Owner's design of 22 September 2026. The page shows the person and nothing
 * about campaigns: name, address, company, salutation, the date it was added,
 * where it came from. Every contact can be edited at any time; the campaigns
 * still to send take the change, and what was already sent stays as it went
 * out, in the history. Adding and editing use the very dialog a campaign uses,
 * with the same four fields.
 *
 * Selecting lines turns them into a new draft campaign, or removes them: a
 * contact removed here leaves the sends still to come, and the history keeps
 * what was already sent.
 */

type SortKey = `${AddressBookSort}:${'asc' | 'desc'}`

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name:asc', label: 'Nom, A à Z' },
  { value: 'name:desc', label: 'Nom, Z à A' },
  { value: 'email:asc', label: 'E-mail, A à Z' },
  { value: 'company:asc', label: 'Entreprise, A à Z' },
  { value: 'company:desc', label: 'Entreprise, Z à A' },
  { value: 'created:desc', label: 'Ajoutés récemment' },
  { value: 'created:asc', label: 'Ajoutés en premier' },
  { value: 'source:asc', label: 'Origine' },
]

const PAGE_SIZES = [25, 50, 100]

const SOURCE_TONE: Record<ContactSource, BadgeTone> = {
  csv: 'neutral',
  manual: 'info',
  mailfind: 'accent',
}

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'failed' }

type Dialog =
  | { kind: 'create' }
  | { kind: 'import' }
  | { kind: 'edit'; contact: BookContact }
  | { kind: 'delete'; contact: BookContact }
  | { kind: 'delete-selection' }
  | { kind: 'campaign-from-selection' }
  | null

export function Contacts() {
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [contacts, setContacts] = useState<BookContact[]>([])
  const [total, setTotal] = useState(0)

  const [search, setSearch] = useState('')
  const [source, setSource] = useState<ContactSource | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('name:asc')
  const [limit, setLimit] = useState(PAGE_SIZES[0] ?? 25)
  const [offset, setOffset] = useState(0)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [deleting, setDeleting] = useState(false)

  const filters = useMemo(() => {
    const [by, order] = sort.split(':') as [AddressBookSort, 'asc' | 'desc']
    return {
      sort: by,
      order,
      ...(search ? { search } : {}),
      ...(source === 'all' ? {} : { source }),
    }
  }, [sort, search, source])

  const fetchPage = useCallback(async () => {
    try {
      const page = await addressBookApi.list({ ...filters, limit, offset })
      setContacts(page.contacts)
      setTotal(page.total)
      setLoad({ state: 'ready' })
    } catch {
      setLoad({ state: 'failed' })
    }
  }, [filters, limit, offset])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void fetchPage()
  }, [fetchPage])

  /** Every filter and every sort goes back to the first page (see History). */
  function refine(apply: () => void) {
    apply()
    setOffset(0)
  }

  function clearFilters() {
    refine(() => {
      setSearch('')
      setSource('all')
    })
  }

  /** A header click sorts by that column, and a second click reverses it. */
  function sortBy(column: AddressBookSort) {
    refine(() => {
      setSort((current) =>
        current === `${column}:asc` ? `${column}:desc` : `${column}:asc`,
      )
    })
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const pageSelected =
    contacts.length > 0 && contacts.every((contact) => selected.has(contact.id))

  function togglePage() {
    setSelected((current) => {
      const next = new Set(current)
      for (const contact of contacts) {
        if (pageSelected) {
          next.delete(contact.id)
        } else {
          next.add(contact.id)
        }
      }
      return next
    })
  }

  /** The last rows of the last page went: step back rather than show an empty page. */
  function reloadAfterRemoving(removed: number) {
    if (removed >= contacts.length && offset > 0) {
      setOffset(Math.max(0, offset - limit))
    } else {
      void fetchPage()
    }
  }

  async function remove(contact: BookContact) {
    setDeleting(true)

    try {
      await addressBookApi.remove(contact.id)
      toast.success(`${contact.email} a été supprimé.`)
      setDialog(null)
      setSelected((current) => {
        const next = new Set(current)
        next.delete(contact.id)
        return next
      })
      reloadAfterRemoving(1)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'La suppression a échoué.')
    } finally {
      setDeleting(false)
    }
  }

  async function removeSelection() {
    setDeleting(true)

    // Settled rather than all-or-nothing: each refusal stays countable, and
    // one contact already gone does not stop the others.
    const ids = [...selected]
    const results = await Promise.allSettled(ids.map((id) => addressBookApi.remove(id)))
    const failed = results.filter((result) => result.status === 'rejected').length
    const removed = ids.length - failed

    setDeleting(false)
    setDialog(null)
    setSelected(new Set())

    if (failed === 0) {
      toast.success(`${countOf(removed, 'contact supprimé', 'contacts supprimés')}.`)
    } else {
      toast.error(
        `${countOf(removed, 'contact supprimé', 'contacts supprimés')}, ${countOf(failed, 'échec')}. Réessayez pour les restants.`,
      )
    }

    reloadAfterRemoving(removed)
  }

  const filtering = search !== '' || source !== 'all'
  const editing = dialog?.kind === 'edit' ? dialog.contact : null

  if (load.state === 'loading' && contacts.length === 0) {
    return <HistorySkeleton />
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Vos contacts, une ligne par adresse, qu’ils viennent d’un fichier, d’un ajout à la main ou de MailFind."
        action={
          <>
            {total > 0 && (
              // Every contact the filters match, all pages, the page's columns.
              <AnchorButton
                href={addressBookApi.exportUrl(filters)}
                download
                variant="secondary"
                icon="download"
                shortLabel="Exporter"
              >
                Exporter en CSV
              </AnchorButton>
            )}
            <Button
              variant="secondary"
              icon="upload"
              shortLabel="Importer"
              onClick={() => {
                setDialog({ kind: 'import' })
              }}
            >
              Importer un fichier
            </Button>
            <Button
              variant="primary"
              icon="plus"
              shortLabel="Ajouter"
              onClick={() => {
                setDialog({ kind: 'create' })
              }}
            >
              Ajouter un contact
            </Button>
          </>
        }
      />

      {load.state === 'failed' ? (
        <ErrorState
          title="Impossible de charger vos contacts"
          onRetry={() => void fetchPage()}
        />
      ) : total === 0 && !filtering ? (
        <EmptyState
          icon="users"
          title="Aucun contact pour le moment"
          description="Importez un fichier CSV ou ajoutez un contact à la main : chaque adresse apparaîtra ici, une seule fois."
          action={
            <span className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                icon="upload"
                onClick={() => {
                  setDialog({ kind: 'import' })
                }}
              >
                Importer un fichier CSV
              </Button>
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => {
                  setDialog({ kind: 'create' })
                }}
              >
                Ajouter un contact
              </Button>
            </span>
          }
        />
      ) : (
        <>
          {/* The search, on its own row. */}
          <SearchInput
            value={search}
            onChange={(value) => {
              refine(() => {
                setSearch(value)
              })
            }}
            placeholder="Nom, adresse ou entreprise…"
            label="Rechercher un contact"
          />

          {/* The filters, on theirs: stacked on a phone, side by side above. */}
          <div
            role="group"
            aria-label="Filtres et tri"
            className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3"
          >
            <Select
              value={sort}
              options={SORT_OPTIONS}
              onChange={(value) => {
                refine(() => {
                  setSort(value)
                })
              }}
              label="Trier"
              labelHidden
            />

            <Select
              value={source}
              options={[
                { value: 'all' as const, label: 'Toutes les origines' },
                ...CONTACT_SOURCES.map((value) => ({ value, label: sourceLabel(value) })),
              ]}
              onChange={(value) => {
                refine(() => {
                  setSource(value)
                })
              }}
              label="Filtrer par origine"
              labelHidden
            />

            <Select
              value={String(limit)}
              options={PAGE_SIZES.map((size) => ({
                value: String(size),
                label: `${String(size)} par page`,
              }))}
              onChange={(value) => {
                refine(() => {
                  setLimit(Number(value))
                })
              }}
              label="Contacts par page"
              labelHidden
              align="end"
            />
          </div>

          <p aria-live="polite" className="mt-3 text-[13px] text-ink-muted">
            {countOf(total, 'contact')}
            {filtering
              ? ` ${total > 1 ? 'correspondent' : 'correspond'} à ces filtres.`
              : ' au total.'}
            {filtering && (
              <button
                type="button"
                onClick={clearFilters}
                className="ms-2 font-medium text-accent underline-offset-2 hover:underline"
              >
                Effacer les filtres
              </button>
            )}
          </p>

          {total === 0 ? (
            <EmptyState
              compact
              icon="search"
              title="Aucun résultat"
              description="Aucun contact ne correspond. Essayez un autre mot, ou retirez un filtre."
              className="mt-4"
              action={
                <Button variant="secondary" icon="close" onClick={clearFilters}>
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <>
              {/* On a phone, one card per contact: six columns do not fit a
                375 px screen, and a table to scroll sideways hides half of
                each line. From 640 px up, the table. */}
              <ul className="mt-3 space-y-2 sm:hidden">
                <li className="flex items-center gap-2 px-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={pageSelected}
                    aria-label="Tout sélectionner sur cette page"
                    onChange={togglePage}
                    className="size-4 accent-accent"
                  />
                  Tout sélectionner
                </li>
                {contacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    selected={selected.has(contact.id)}
                    onToggle={() => {
                      toggle(contact.id)
                    }}
                    onEdit={() => {
                      setDialog({ kind: 'edit', contact })
                    }}
                    onDelete={() => {
                      setDialog({ kind: 'delete', contact })
                    }}
                  />
                ))}
              </ul>

              <Card className="mt-3 overflow-hidden max-sm:hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-xl text-left text-[13px] md:min-w-3xl">
                    <thead className="border-b border-border bg-surface-2 text-xs text-ink-muted">
                      <tr>
                        <th scope="col" className="w-10 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={pageSelected}
                            aria-label="Tout sélectionner sur cette page"
                            onChange={togglePage}
                            className="size-4 accent-accent"
                          />
                        </th>
                        <SortHeader
                          column="name"
                          label="Nom"
                          sort={sort}
                          onSort={sortBy}
                        />
                        <SortHeader
                          column="email"
                          label="E-mail"
                          sort={sort}
                          onSort={sortBy}
                        />
                        <SortHeader
                          column="company"
                          label="Entreprise"
                          sort={sort}
                          onSort={sortBy}
                        />
                        <th scope="col" className="px-3 py-2.5 font-medium max-md:hidden">
                          Civilité
                        </th>
                        <SortHeader
                          column="created"
                          label="Ajouté le"
                          sort={sort}
                          onSort={sortBy}
                          className="max-lg:hidden"
                        />
                        <SortHeader
                          column="source"
                          label="Origine"
                          sort={sort}
                          onSort={sortBy}
                        />
                        <th scope="col" className="px-3 py-2.5">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {load.state === 'loading'
                        ? Array.from({ length: 6 }, (_, index) => (
                            <tr
                              key={`skeleton-${String(index)}`}
                              className="border-b border-border last:border-0"
                            >
                              {Array.from({ length: 6 }, (_, cell) => (
                                <td key={cell} className="px-3 py-3">
                                  <Skeleton className="h-3 w-full" />
                                </td>
                              ))}
                            </tr>
                          ))
                        : contacts.map((contact) => (
                            <Row
                              key={contact.id}
                              contact={contact}
                              selected={selected.has(contact.id)}
                              onToggle={() => {
                                toggle(contact.id)
                              }}
                              onEdit={() => {
                                setDialog({ kind: 'edit', contact })
                              }}
                              onDelete={() => {
                                setDialog({ kind: 'delete', contact })
                              }}
                            />
                          ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <Pagination
            offset={offset}
            limit={limit}
            total={total}
            onChange={setOffset}
            label="Pagination des contacts"
            className="mt-4"
          />
        </>
      )}

      {/* The selection bar: only once something is selected, floating above
          the page so it stays reachable while scrolling a long list. */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-border glass px-3 py-2.5 shadow-pop sm:gap-3 sm:px-4">
            <p className="text-[13px] font-medium">
              {countOf(selected.size, 'contact sélectionné', 'contacts sélectionnés')}
            </p>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(new Set())
              }}
            >
              Désélectionner
            </Button>

            <Button
              size="sm"
              variant="secondary"
              icon="trash"
              className="hover:text-danger"
              onClick={() => {
                setDialog({ kind: 'delete-selection' })
              }}
            >
              Supprimer
            </Button>

            <Button
              size="sm"
              variant="primary"
              icon="send"
              onClick={() => {
                setDialog({ kind: 'campaign-from-selection' })
              }}
            >
              Créer une campagne
            </Button>
          </div>
        </div>
      )}

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <AddContactDialog
          // Keyed so each opening starts from the contact it edits.
          key={editing?.id ?? 'new'}
          open
          target="book"
          {...(editing
            ? {
                initial: {
                  email: editing.email,
                  ...(editing.contactName ? { contact_name: editing.contactName } : {}),
                  ...(editing.companyName ? { company_name: editing.companyName } : {}),
                  ...(editing.salutation ? { salutation: editing.salutation } : {}),
                },
              }
            : {})}
          save={(row) =>
            editing ? addressBookApi.update(editing.id, row) : addressBookApi.create(row)
          }
          onClose={() => {
            setDialog(null)
          }}
          onAdded={() => {
            void fetchPage()
          }}
        />
      )}

      {/* The campaign's own import dialog, pointed at the contacts: the same
          file handling, column mapping and line-numbered report. */}
      <ImportDialog
        open={dialog?.kind === 'import'}
        importRows={(rows, onProgress) => addressBookApi.importRows(rows, onProgress)}
        onClose={() => {
          setDialog(null)
        }}
        onImported={() => {
          void fetchPage()
        }}
      />

      {dialog?.kind === 'campaign-from-selection' && (
        <CampaignFromSelectionDialog
          contactIds={[...selected]}
          onClose={() => {
            setDialog(null)
          }}
          onCreated={(campaignId) => {
            setDialog(null)
            setSelected(new Set())
            void navigate(`/campaigns/${campaignId}`)
          }}
        />
      )}

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onClose={() => {
          setDialog(null)
        }}
        onConfirm={() => {
          if (dialog?.kind === 'delete') {
            void remove(dialog.contact)
          }
        }}
        busy={deleting}
        tone="danger"
        icon="trash"
        title="Supprimer ce contact ?"
        confirmLabel="Supprimer"
        description={
          dialog?.kind === 'delete' ? (
            <>
              <strong className="font-semibold text-ink">{dialog.contact.email}</strong>{' '}
              sera retiré de vos contacts et des envois à venir. Les messages déjà envoyés
              restent dans l’historique.
            </>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={dialog?.kind === 'delete-selection'}
        onClose={() => {
          setDialog(null)
        }}
        onConfirm={() => void removeSelection()}
        busy={deleting}
        tone="danger"
        icon="trash"
        title={`Supprimer ${countOf(selected.size, 'contact')} ?`}
        confirmLabel="Supprimer"
        description="Ils seront retirés de vos contacts et des envois à venir. Les messages déjà envoyés restent dans l’historique."
      />
    </>
  )
}

/**
 * Turning a selection into a campaign: a new draft, then the contacts copied
 * into it on the server. Nothing is sent until the user writes the message and
 * launches it. If the copy fails, the empty draft is removed rather than left
 * behind.
 */
function CampaignFromSelectionDialog({
  contactIds,
  onClose,
  onCreated,
}: {
  contactIds: string[]
  onClose: () => void
  onCreated: (campaignId: string) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<CampaignType>('prospection')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  async function create() {
    if (name.trim() === '') {
      setNameError('Donnez un nom à la campagne.')
      return
    }

    setBusy(true)
    setFailure(null)

    let campaignId: string | null = null

    try {
      const campaign = await campaignsApi.create({
        name: name.trim().slice(0, 200),
        type,
      })
      campaignId = campaign.id
      const { imported } = await addressBookApi.copyToCampaign(campaign.id, contactIds)

      toast.success(`Campagne créée avec ${countOf(imported, 'contact')}.`)
      onCreated(campaign.id)
    } catch (err) {
      if (campaignId) {
        await campaignsApi.remove(campaignId).catch(() => undefined)
      }
      setFailure(
        err instanceof ApiError && err.status === 0
          ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
          : 'La campagne n’a pas pu être créée. Réessayez.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon="send"
      title="Créer une campagne"
      description={
        <>
          Les {countOf(contactIds.length, 'contact sélectionné', 'contacts sélectionnés')}{' '}
          deviendront les destinataires d’une nouvelle campagne en brouillon. Rien n’est
          envoyé : vous écrirez le message, puis vous la lancerez.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon="plus"
            loading={busy}
            onClick={() => void create()}
          >
            Créer la campagne
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {failure && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] text-danger"
          >
            <Icon name="alert" size={15} className="mt-px shrink-0" />
            <span>{failure}</span>
          </p>
        )}

        <TextField
          label="Nom de la campagne"
          value={name}
          maxLength={200}
          autoFocus
          placeholder="Prospection, octobre"
          error={nameError}
          onChange={(event) => {
            setName(event.target.value)
            setNameError(null)
          }}
        />

        <Select
          label="Type de campagne"
          value={type}
          onChange={setType}
          options={CAMPAIGN_TYPES.map((value) => ({
            value,
            label: campaignTypeLabel(value),
          }))}
        />
      </div>
    </Modal>
  )
}

function SortHeader({
  column,
  label,
  sort,
  onSort,
  className = '',
}: {
  column: AddressBookSort
  label: string
  sort: SortKey
  onSort: (column: AddressBookSort) => void
  className?: string
}) {
  const [by, order] = sort.split(':')
  const active = by === column

  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2.5 font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => {
          onSort(column)
        }}
        className={`-mx-1 inline-flex items-center gap-1 rounded-md px-1 whitespace-nowrap hover:text-ink ${active ? 'text-ink' : ''}`}
      >
        {label}
        <Icon
          name="chevron-down"
          size={12}
          className={`transition-transform duration-150 ${active ? '' : 'opacity-0'} ${active && order === 'asc' ? 'rotate-180' : ''}`}
        />
      </button>
    </th>
  )
}

/** One contact on a phone: the same details and actions as a table row. */
function ContactCard({
  contact,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  contact: BookContact
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const details = [contact.companyName, contact.salutation].filter(Boolean).join(' · ')

  return (
    <li
      className={`flex items-start gap-3 rounded-2xl border border-border p-3 ${selected ? 'bg-accent-soft/40' : 'bg-surface'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Sélectionner ${contact.email}`}
        onChange={onToggle}
        className="mt-1 size-4 shrink-0 accent-accent"
      />

      <div className="min-w-0 flex-1 text-[13px]">
        <p className="truncate font-medium">{contact.contactName ?? contact.email}</p>
        {contact.contactName && (
          <p className="truncate text-ink-muted">{contact.email}</p>
        )}
        {details && <p className="truncate text-xs text-ink-muted">{details}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
          <Badge tone={SOURCE_TONE[contact.source]}>{sourceLabel(contact.source)}</Badge>
          <span className="tabular">Ajouté le {formatDate(contact.createdAt)}</span>
        </p>
      </div>

      <div className="flex shrink-0 gap-0.5">
        <IconButton
          icon="edit"
          size="sm"
          label={`Modifier ${contact.email}`}
          onClick={onEdit}
        />
        <IconButton
          icon="trash"
          size="sm"
          label={`Supprimer ${contact.email}`}
          onClick={onDelete}
          className="hover:text-danger"
        />
      </div>
    </li>
  )
}

function Row({
  contact,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  contact: BookContact
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const empty = <span className="text-ink-subtle">—</span>

  return (
    <tr
      className={`border-b border-border transition-colors last:border-0 hover:bg-surface-2 ${selected ? 'bg-accent-soft/40' : ''}`}
    >
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Sélectionner ${contact.email}`}
          onChange={onToggle}
          className="size-4 accent-accent"
        />
      </td>
      <td className="max-w-44 truncate px-3 py-2.5 font-medium">
        {contact.contactName ?? empty}
      </td>
      <td className="max-w-60 truncate px-3 py-2.5">{contact.email}</td>
      <td className="max-w-44 truncate px-3 py-2.5">{contact.companyName ?? empty}</td>
      <td className="px-3 py-2.5 max-md:hidden">{contact.salutation ?? empty}</td>
      <td className="tabular px-3 py-2.5 whitespace-nowrap text-ink-muted max-lg:hidden">
        {formatDate(contact.createdAt)}
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={SOURCE_TONE[contact.source]}>{sourceLabel(contact.source)}</Badge>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex justify-end gap-1">
          <IconButton
            icon="edit"
            size="sm"
            label={`Modifier ${contact.email}`}
            onClick={onEdit}
          />
          <IconButton
            icon="trash"
            size="sm"
            label={`Supprimer ${contact.email}`}
            onClick={onDelete}
            className="hover:text-danger"
          />
        </div>
      </td>
    </tr>
  )
}
