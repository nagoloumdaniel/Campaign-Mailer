import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/campaign/CampaignBadges'
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog'
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
  type Campaign,
  type CampaignType,
} from '@/services/campaigns'
import { contactStatusLabel, type ContactStatus } from '@/services/contacts'
import { countOf, formatDate } from '@/services/format'

/**
 * Every contact of the account, whatever campaign it sits in and wherever it
 * came from: a CSV file, typed by hand, or sent by MailFind.
 *
 * The campaign page answers "who does this campaign write to". This page
 * answers the question that comes later, once there are five campaigns: "do I
 * already have this company, and in which campaign". So it is one table over
 * all of them, sorted by company by default, searchable on every text column,
 * and every column that can sort does so from its header.
 *
 * The search has its row, the filters have theirs: four selects beside a
 * search field squeeze each other at every width short of a wide screen, and
 * on a phone they stack one per line instead.
 *
 * Selecting rows turns the page into the start of a campaign: the contacts
 * are copied server-side into a new draft, the same mechanism the history
 * uses for a follow-up. The selection survives paging, so a list can be built
 * from several pages of a search.
 *
 * Adding and editing follow the campaign's own rule: only while the campaign is
 * a draft. A launched campaign's list is what the send engine plans from, so
 * its rows show a read-only eye instead of a pencil, with the reason on hover.
 * Removing is always possible: someone who asks to be forgotten is forgotten,
 * and the history keeps the line of what was sent, without the contact.
 */

type SortKey = `${AddressBookSort}:${'asc' | 'desc'}`

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'company:asc', label: 'Entreprise, A à Z' },
  { value: 'company:desc', label: 'Entreprise, Z à A' },
  { value: 'name:asc', label: 'Nom, A à Z' },
  { value: 'name:desc', label: 'Nom, Z à A' },
  { value: 'email:asc', label: 'Adresse, A à Z' },
  { value: 'campaign:asc', label: 'Campagne, A à Z' },
  { value: 'status:asc', label: 'Statut' },
  { value: 'created:desc', label: 'Ajoutés récemment' },
  { value: 'created:asc', label: 'Ajoutés en premier' },
]

const PAGE_SIZES = [25, 50, 100]

const STATUS_OPTIONS: { value: ContactStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous les statuts' },
  ...(['pending', 'sent', 'failed', 'ignored'] as const).map((status) => ({
    value: status,
    label: contactStatusLabel(status),
  })),
]

const STATUS_TONE: Record<ContactStatus, BadgeTone> = {
  pending: 'neutral',
  sent: 'success',
  failed: 'danger',
  ignored: 'warning',
}

const SOURCE_TONE: Record<ContactSource, BadgeTone> = {
  csv: 'neutral',
  manual: 'info',
  mailfind: 'accent',
}

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'failed' }

type Dialog =
  | { kind: 'create' }
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ContactStatus | 'all'>('all')
  const [source, setSource] = useState<ContactSource | 'all'>('all')
  const [campaignId, setCampaignId] = useState('all')
  const [sort, setSort] = useState<SortKey>('company:asc')
  const [limit, setLimit] = useState(PAGE_SIZES[0] ?? 25)
  const [offset, setOffset] = useState(0)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [deleting, setDeleting] = useState(false)

  const query = useMemo(() => {
    const [by, order] = sort.split(':') as [AddressBookSort, 'asc' | 'desc']
    return {
      sort: by,
      order,
      limit,
      offset,
      ...(search ? { search } : {}),
      ...(status === 'all' ? {} : { status }),
      ...(source === 'all' ? {} : { source }),
      ...(campaignId === 'all' ? {} : { campaignId }),
    }
  }, [sort, limit, offset, search, status, source, campaignId])

  const fetchPage = useCallback(async () => {
    try {
      const page = await addressBookApi.list(query)
      setContacts(page.contacts)
      setTotal(page.total)
      setLoad({ state: 'ready' })
    } catch {
      setLoad({ state: 'failed' })
    }
  }, [query])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void fetchPage()
  }, [fetchPage])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void campaignsApi
      .list()
      .then(setCampaigns)
      .catch(() => {
        setCampaigns([])
      })
  }, [])

  const drafts = campaigns.filter((campaign) => campaign.status === 'draft')

  /** Every filter and every sort goes back to the first page (see History). */
  function refine(apply: () => void) {
    apply()
    setOffset(0)
  }

  function clearFilters() {
    refine(() => {
      setSearch('')
      setStatus('all')
      setSource('all')
      setCampaignId('all')
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

  const filtering =
    search !== '' || status !== 'all' || source !== 'all' || campaignId !== 'all'

  if (load.state === 'loading' && contacts.length === 0) {
    return <HistorySkeleton />
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Tous les contacts de vos campagnes, importés d’un fichier, ajoutés à la main ou reçus de MailFind."
        action={
          <>
            {total > 0 && (
              // Every contact the filters match, all pages, every column.
              <AnchorButton
                href={addressBookApi.exportUrl({
                  sort: query.sort,
                  order: query.order,
                  ...(search ? { search } : {}),
                  ...(status === 'all' ? {} : { status }),
                  ...(source === 'all' ? {} : { source }),
                  ...(campaignId === 'all' ? {} : { campaignId }),
                })}
                download
                variant="secondary"
                icon="download"
              >
                Exporter en CSV
              </AnchorButton>
            )}
            <Button
              variant="primary"
              icon="plus"
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
          description="Ajoutez un contact ou importez un fichier CSV dans une campagne : chaque contact apparaîtra ici."
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setDialog({ kind: 'create' })
              }}
            >
              Ajouter un contact
            </Button>
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
            placeholder="Rechercher une adresse, un nom, une entreprise ou une campagne…"
            label="Rechercher un contact"
          />

          {/* The filters, on theirs: one per line on a phone, two on a tablet,
              four side by side from a laptop up. */}
          <div
            role="group"
            aria-label="Filtres et tri"
            className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-4"
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
              value={campaignId}
              options={[
                { value: 'all', label: 'Toutes les campagnes' },
                ...campaigns.map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                })),
              ]}
              onChange={(value) => {
                refine(() => {
                  setCampaignId(value)
                })
              }}
              label="Filtrer par campagne"
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
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p aria-live="polite" className="text-[13px] text-ink-muted">
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
              className="w-36"
            />
          </div>

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
            <Card className="mt-3 overflow-hidden">
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
                        label="Contact"
                        sort={sort}
                        onSort={sortBy}
                      />
                      <SortHeader
                        column="company"
                        label="Entreprise"
                        sort={sort}
                        onSort={sortBy}
                      />
                      <SortHeader
                        column="campaign"
                        label="Campagne"
                        sort={sort}
                        onSort={sortBy}
                      />
                      <th scope="col" className="px-3 py-2.5 font-medium max-md:hidden">
                        Origine
                      </th>
                      <SortHeader
                        column="status"
                        label="Statut"
                        sort={sort}
                        onSort={sortBy}
                      />
                      <SortHeader
                        column="created"
                        label="Ajouté le"
                        sort={sort}
                        onSort={sortBy}
                        className="max-lg:hidden"
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
        <ContactFormDialog
          // Keyed so each opening starts from the contact it edits.
          key={dialog.kind === 'edit' ? dialog.contact.id : 'new'}
          open
          contact={dialog.kind === 'edit' ? dialog.contact : null}
          drafts={drafts}
          onClose={() => {
            setDialog(null)
          }}
          onSaved={() => {
            void fetchPage()
          }}
          onCampaignCreated={(campaign) => {
            setCampaigns((current) => [campaign, ...current])
          }}
        />
      )}

      {dialog?.kind === 'campaign-from-selection' && (
        <CampaignFromSelectionDialog
          contactIds={[...selected]}
          onClose={() => {
            setDialog(null)
          }}
          onCreated={(campaign) => {
            setDialog(null)
            setSelected(new Set())
            void navigate(`/campaigns/${campaign}`)
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
              sera retiré de la campagne « {dialog.contact.campaign.name} ».{' '}
              {dialog.contact.status === 'sent'
                ? 'L’historique garde la trace de l’envoi, sans le contact.'
                : 'Il ne recevra aucun message de cette campagne.'}
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
        description="Chacun sera retiré de sa campagne. Pour ceux qui ont déjà reçu un message, l’historique garde la trace de l’envoi, sans le contact."
      />
    </>
  )
}

/**
 * Turning a selection into a campaign.
 *
 * The contacts are copied server-side from their ids, into a new draft: nothing
 * is sent until the user writes the message and launches it. An address
 * selected twice, from two campaigns, is copied once.
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

    try {
      const { campaign, imported } = await campaignsApi.followUp({
        name: name.trim().slice(0, 200),
        contact_ids: contactIds,
        type,
      })

      toast.success(`Campagne créée avec ${countOf(imported, 'contact')}.`)
      onCreated(campaign.id)
    } catch (err) {
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
          seront copiés dans une nouvelle campagne en brouillon. Rien n’est envoyé : vous
          écrirez le message, puis vous la lancerez.
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
  const editable = contact.campaign.status === 'draft'

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

      <td className="max-w-60 px-3 py-2.5">
        <span className="block truncate font-medium">
          {contact.contactName ?? contact.email}
        </span>
        {contact.contactName && (
          <span className="block truncate text-xs text-ink-muted">{contact.email}</span>
        )}
      </td>

      <td className="max-w-44 truncate px-3 py-2.5">
        {contact.companyName ?? <span className="text-ink-subtle">—</span>}
      </td>

      <td className="max-w-52 px-3 py-2.5">
        <Link
          to={`/campaigns/${contact.campaign.id}`}
          className="block truncate hover:text-accent hover:underline"
        >
          {contact.campaign.name}
        </Link>
        <span className="mt-1 block">
          <StatusBadge status={contact.campaign.status} />
        </span>
      </td>

      <td className="px-3 py-2.5 max-md:hidden">
        <Badge tone={SOURCE_TONE[contact.source]}>{sourceLabel(contact.source)}</Badge>
      </td>

      <td className="px-3 py-2.5">
        <Badge tone={STATUS_TONE[contact.status]}>
          {contactStatusLabel(contact.status)}
        </Badge>
      </td>

      <td className="tabular px-3 py-2.5 whitespace-nowrap text-ink-muted max-lg:hidden">
        {formatDate(contact.createdAt)}
      </td>

      <td className="px-3 py-2.5">
        <div className="flex justify-end gap-1">
          {editable ? (
            <IconButton
              icon="edit"
              size="sm"
              label={`Modifier ${contact.email}`}
              onClick={onEdit}
            />
          ) : (
            <span
              title="Campagne lancée : ce contact n’est plus modifiable."
              className="flex size-8 items-center justify-center text-ink-subtle"
            >
              <Icon name="eye" size={15} />
              <span className="sr-only">Lecture seule : la campagne a été lancée.</span>
            </span>
          )}
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
