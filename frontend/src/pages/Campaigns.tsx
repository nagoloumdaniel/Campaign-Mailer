import { useCallback, useEffect, useMemo, useState } from 'react'

import { CampaignCard } from '@/components/campaign/CampaignCard'
import { DeleteCampaignDialog } from '@/components/campaign/DeleteCampaignDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { CampaignListSkeleton } from '@/components/skeletons/PageSkeletons'
import { Button, LinkButton } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'
import {
  CAMPAIGN_TYPES,
  campaignTypeLabel,
  campaignsApi,
  statusLabel,
  type Campaign,
  type CampaignStatus,
  type CampaignType,
} from '@/services/campaigns'
import { countOf } from '@/services/format'
import { exportCampaignsCsv } from '@/services/exports'

type Load =
  { state: 'loading' } | { state: 'ready'; campaigns: Campaign[] } | { state: 'failed' }

type StatusFilter = CampaignStatus | 'all'
type TypeFilter = CampaignType | 'all'
type SortKey = 'recent' | 'name' | 'progress' | 'size'

const PAGE = 8

/** One array, so the memo below does not see a new dependency on every render. */
const NONE: Campaign[] = []

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'draft', label: statusLabel('draft') },
  { value: 'scheduled', label: statusLabel('scheduled') },
  { value: 'running', label: statusLabel('running') },
  { value: 'paused', label: statusLabel('paused') },
  { value: 'completed', label: statusLabel('completed') },
]

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Tous les types' },
  ...CAMPAIGN_TYPES.map((type) => ({ value: type, label: campaignTypeLabel(type) })),
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'name', label: 'Nom (A → Z)' },
  { value: 'progress', label: 'Progression' },
  { value: 'size', label: 'Nombre de contacts' },
]

/**
 * Every campaign, with the tools to find one.
 *
 * The dashboard answers "what is happening"; this page answers "where is that
 * campaign I made in March". So it is a list with a search, two filters and a
 * sort, and no summary figures at all — repeating the dashboard's numbers
 * here would make both pages feel like the same page done twice.
 *
 * The filtering is done in the browser. The campaign list is one request that
 * returns every campaign of the account, and an account has tens of them, not
 * thousands; a server-side search would add a route and a round trip per
 * keystroke to make a list of forty rows instant, which it already is.
 */
export function Campaigns() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [offset, setOffset] = useState(0)
  const [toDelete, setToDelete] = useState<Campaign | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', campaigns: await campaignsApi.list() })
    } catch {
      setLoad((current) => (current.state === 'ready' ? current : { state: 'failed' }))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const all = load.state === 'ready' ? load.campaigns : NONE

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()

    const matched = all.filter((campaign) => {
      if (status !== 'all' && campaign.status !== status) {
        return false
      }
      if (type !== 'all' && campaign.type !== type) {
        return false
      }
      if (needle === '') {
        return true
      }

      return (
        campaign.name.toLowerCase().includes(needle) ||
        (campaign.subject ?? '').toLowerCase().includes(needle)
      )
    })

    // Sorted on a copy: the loaded list stays in the order the API gave it,
    // so switching the sort back is exact rather than approximate.
    return [...matched].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name, 'fr')
        case 'size':
          return b.totalContacts - a.totalContacts
        case 'progress': {
          const share = (campaign: Campaign) =>
            campaign.totalContacts === 0
              ? 0
              : (campaign.sentCount + campaign.errorCount) / campaign.totalContacts
          return share(b) - share(a)
        }
        case 'recent':
        default:
          return Date.parse(b.createdAt) - Date.parse(a.createdAt)
      }
    })
  }, [all, search, status, type, sort])

  /**
   * Every filter goes back to the first page.
   *
   * Done in the handler rather than in an effect watching the filters: an
   * effect would render the third page of the new filter once — usually
   * empty — before correcting itself, and that flash reads as a bug.
   */
  function refine(apply: () => void) {
    apply()
    setOffset(0)
  }

  const page = filtered.slice(offset, offset + PAGE)
  const filtering = search !== '' || status !== 'all' || type !== 'all'

  if (load.state === 'loading') {
    return <CampaignListSkeleton />
  }

  if (load.state === 'failed') {
    return (
      <>
        <PageHeader title="Campagnes" />
        <ErrorState
          title="Impossible de charger vos campagnes"
          onRetry={() => {
            setLoad({ state: 'loading' })
            void refresh()
          }}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Campagnes"
        description={
          all.length === 0
            ? 'Une campagne, c’est un message, une liste de contacts et un rythme d’envoi.'
            : `${countOf(all.length, 'campagne')} au total.`
        }
        action={
          <>
            {all.length > 0 && (
              <Button
                variant="secondary"
                icon="download"
                onClick={() => {
                  exportCampaignsCsv(filtered)
                }}
              >
                Exporter
              </Button>
            )}
            <LinkButton to="/campaigns/new" variant="primary" icon="plus">
              Nouvelle campagne
            </LinkButton>
          </>
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon="send"
          title="Aucune campagne pour le moment"
          description="Créez-en une pour rédiger votre message, puis importez vos contacts depuis un fichier CSV."
          action={
            <LinkButton to="/campaigns/new" variant="primary" icon="plus">
              Créer une campagne
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(value) => {
                refine(() => {
                  setSearch(value)
                })
              }}
              placeholder="Rechercher une campagne…"
              label="Rechercher une campagne"
              className="min-w-0 flex-1 sm:max-w-xs"
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
              className="w-40"
            />

            <Select
              value={type}
              options={TYPE_OPTIONS}
              onChange={(value) => {
                refine(() => {
                  setType(value)
                })
              }}
              label="Filtrer par type"
              labelHidden
              className="w-44"
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
              align="end"
              className="w-44"
            />
          </div>

          <p aria-live="polite" className="mt-3 text-[13px] text-ink-muted">
            {filtering
              ? `${countOf(filtered.length, 'campagne')} ${filtered.length > 1 ? 'correspondent' : 'correspond'} à ce filtre.`
              : `${countOf(filtered.length, 'campagne')}.`}
          </p>

          {filtered.length === 0 ? (
            <EmptyState
              compact
              icon="search"
              title="Aucun résultat"
              description="Aucune campagne ne correspond à votre recherche. Essayez un autre mot, ou retirez un filtre."
              className="mt-4"
              action={
                <Button
                  variant="secondary"
                  icon="close"
                  onClick={() => {
                    refine(() => {
                      setSearch('')
                      setStatus('all')
                      setType('all')
                    })
                  }}
                >
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {page.map((campaign, index) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    index={Math.min(index, 8)}
                    onDelete={setToDelete}
                  />
                ))}
              </ul>

              <Pagination
                offset={offset}
                limit={PAGE}
                total={filtered.length}
                onChange={setOffset}
                label="Pagination des campagnes"
                className="mt-5"
              />
            </>
          )}
        </>
      )}

      <DeleteCampaignDialog
        campaign={toDelete}
        onClose={() => {
          setToDelete(null)
        }}
        onDeleted={() => {
          setToDelete(null)
          void refresh()
        }}
      />
    </>
  )
}
