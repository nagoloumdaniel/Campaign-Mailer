import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/campaign/CampaignBadges'
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { HistorySkeleton } from '@/components/skeletons/PageSkeletons'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/Modal'
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
import { campaignsApi, type Campaign } from '@/services/campaigns'
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
 * Adding and editing follow the campaign's own rule: only while the campaign is
 * a draft. A launched campaign's list is what the send engine plans from, so
 * its rows show a read-only eye instead of a pencil, with the reason on hover. Removing
 * is always possible: someone who asks to be forgotten is forgotten, and the
 * history keeps the line of what was sent, without the contact.
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
  | null

export function Contacts() {
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

  /** A header click sorts by that column, and a second click reverses it. */
  function sortBy(column: AddressBookSort) {
    refine(() => {
      setSort((current) =>
        current === `${column}:asc` ? `${column}:desc` : `${column}:asc`,
      )
    })
  }

  async function remove(contact: BookContact) {
    setDeleting(true)

    try {
      await addressBookApi.remove(contact.id)
      toast.success(`${contact.email} a été supprimé.`)
      setDialog(null)
      // The last row of the last page: step back rather than show an empty page.
      if (contacts.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - limit))
      } else {
        void fetchPage()
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'La suppression a échoué.')
    } finally {
      setDeleting(false)
    }
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
          <Button
            variant="primary"
            icon="plus"
            disabled={drafts.length === 0}
            title={
              drafts.length === 0
                ? 'Créez d’abord une campagne : un contact rejoint toujours une campagne en brouillon.'
                : undefined
            }
            onClick={() => {
              setDialog({ kind: 'create' })
            }}
          >
            Ajouter un contact
          </Button>
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
          description="Importez un fichier CSV dans une campagne, ajoutez un contact à la main, ou envoyez une sélection depuis MailFind : chaque contact apparaîtra ici."
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
            <SearchInput
              value={search}
              onChange={(value) => {
                refine(() => {
                  setSearch(value)
                })
              }}
              placeholder="Adresse, nom, entreprise ou campagne…"
              label="Rechercher un contact"
              className="sm:col-span-2 lg:col-span-1"
            />

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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-[13px] text-ink-muted">
              {countOf(total, 'contact')}
              {filtering
                ? ` ${total > 1 ? 'correspondent' : 'correspond'} à ces filtres.`
                : ' au total.'}
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
                <Button
                  variant="secondary"
                  icon="close"
                  onClick={() => {
                    refine(() => {
                      setSearch('')
                      setStatus('all')
                      setSource('all')
                      setCampaignId('all')
                    })
                  }}
                >
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <Card className="mt-3 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-2xl text-left text-[13px]">
                  <thead className="border-b border-border bg-surface-2 text-xs text-ink-muted">
                    <tr>
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
                      <th scope="col" className="px-3 py-2.5 font-medium">
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
                            {Array.from({ length: 7 }, (_, cell) => (
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
          onSaved={(saved) => {
            toast.success(
              dialog.kind === 'edit'
                ? 'Contact enregistré.'
                : `${saved.email} a été ajouté.`,
            )
            setDialog(null)
            void fetchPage()
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
    </>
  )
}

function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: AddressBookSort
  label: string
  sort: SortKey
  onSort: (column: AddressBookSort) => void
}) {
  const [by, order] = sort.split(':')
  const active = by === column

  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2.5 font-medium"
    >
      <button
        type="button"
        onClick={() => {
          onSort(column)
        }}
        className={`-mx-1 inline-flex items-center gap-1 rounded-md px-1 hover:text-ink ${active ? 'text-ink' : ''}`}
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
  onEdit,
  onDelete,
}: {
  contact: BookContact
  onEdit: () => void
  onDelete: () => void
}) {
  const editable = contact.campaign.status === 'draft'

  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-surface-2">
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

      <td className="px-3 py-2.5">
        <Badge tone={SOURCE_TONE[contact.source]}>{sourceLabel(contact.source)}</Badge>
      </td>

      <td className="px-3 py-2.5">
        <Badge tone={STATUS_TONE[contact.status]}>
          {contactStatusLabel(contact.status)}
        </Badge>
      </td>

      <td className="tabular px-3 py-2.5 whitespace-nowrap text-ink-muted">
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
