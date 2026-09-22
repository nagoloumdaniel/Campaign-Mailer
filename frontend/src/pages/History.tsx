import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { CampaignRecords } from '@/components/history/CampaignRecords'
import { PageHeader, SectionHeader } from '@/components/layout/PageHeader'
import { HistorySkeleton } from '@/components/skeletons/PageSkeletons'
import { AnchorButton, Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { ApiError } from '@/services/api'
import {
  CAMPAIGN_TYPES,
  campaignTypeLabel,
  campaignsApi,
  type Campaign,
  type CampaignType,
} from '@/services/campaigns'
import { countOf, formatDateTime, formatNumber } from '@/services/format'
import { historyApi, type HistoryEntry, type HistoryOutcome } from '@/services/history'

const PAGE = 20

type TypeFilter = CampaignType | 'all'
type OutcomeFilter = HistoryOutcome | 'all'

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'failed' }

const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: 'all', label: 'Tous les résultats' },
  { value: 'sent', label: 'Envoyés' },
  { value: 'failed', label: 'En erreur' },
]

/**
 * Every message this account has sent, across every campaign.
 *
 * It answers a question no campaign page can: "have I already written to this
 * company, and when". So it is one list, searchable by address, by name, by
 * company and by campaign, grouped into tabs by the campaign's type because
 * that is how the work itself is grouped — a prospecting run and a follow-up
 * are different things even when they reach the same person.
 *
 * Selecting rows turns the page into the start of a follow-up campaign. That
 * is the whole reason the selection exists: the alternative is exporting the
 * addresses, filtering them in a spreadsheet and importing them back, which is
 * three steps and a chance to lose the accents.
 *
 * Read from the send log rather than from the contacts, so a follow-up's
 * recipients are not counted twice against the run they came from.
 */
export function History() {
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [byType, setByType] = useState<Record<CampaignType, number> | null>(null)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [outcome, setOutcome] = useState<OutcomeFilter>('all')
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const filters = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(type === 'all' ? {} : { type }),
      ...(outcome === 'all' ? {} : { outcome }),
      ...(campaignId ? { campaignId } : {}),
    }),
    [search, type, outcome, campaignId],
  )

  const fetchPage = useCallback(async () => {
    setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }))

    try {
      const page = await historyApi.list(filters, { limit: PAGE, offset })
      setEntries(page.history)
      setTotal(page.total)
      setByType(page.byType)
      setLoad({ state: 'ready' })
    } catch {
      setLoad({ state: 'failed' })
    }
  }, [filters, offset])

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

  const launched = campaigns.filter((campaign) => campaign.status !== 'draft')

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

  /** Only a row with a contact behind it can seed a follow-up. */
  const selectable = entries.filter((entry) => entry.contactId !== null)
  const allSelected =
    selectable.length > 0 && selectable.every((entry) => selected.has(entry.contactId!))

  function toggle(contactId: string) {
    setSelected((current) => {
      const next = new Set(current)

      if (next.has(contactId)) {
        next.delete(contactId)
      } else {
        next.add(contactId)
      }

      return next
    })
  }

  const filtering =
    search !== '' || type !== 'all' || outcome !== 'all' || campaignId !== null
  const empty = total === 0 && !filtering

  if (load.state === 'loading' && entries.length === 0) {
    return <HistorySkeleton />
  }

  return (
    <>
      <PageHeader
        title="Historique"
        description="Vos campagnes lancées et ce qu’elles ont donné, puis le détail de chaque envoi."
        action={
          total > 0 && (
            <AnchorButton
              href={historyApi.exportUrl(filters)}
              download
              variant="secondary"
              icon="download"
            >
              Exporter
            </AnchorButton>
          )
        }
      />

      {load.state === 'failed' ? (
        <ErrorState
          title="Impossible de charger votre historique"
          onRetry={() => void fetchPage()}
        />
      ) : empty ? (
        <EmptyState
          icon="history"
          title="Aucun e-mail envoyé pour le moment"
          description="Dès qu’une campagne aura envoyé son premier message, il apparaîtra ici avec son destinataire et sa date."
        />
      ) : (
        <>
          <CampaignRecords
            campaigns={campaigns}
            selectedId={campaignId}
            onSelect={(id) => {
              refine(() => {
                setCampaignId(id)
              })
              document
                .getElementById('log-heading')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />

          <SectionHeader
            id="log-heading"
            title="Journal des envois"
            description="Chaque e-mail envoyé, avec son destinataire tel qu’il était au moment de l’envoi."
            className="mt-8 mb-3 scroll-mt-24"
          />

          {byType && (
            <SegmentedControl
              value={type}
              onChange={(value) => {
                refine(() => {
                  setType(value)
                })
              }}
              label="Filtrer par type de campagne"
              className="mb-4 max-w-full"
              segments={[
                {
                  value: 'all' as TypeFilter,
                  label: 'Tous',
                  count: Object.values(byType).reduce((sum, count) => sum + count, 0),
                },
                ...CAMPAIGN_TYPES.filter((candidate) => byType[candidate] > 0).map(
                  (candidate) => ({
                    value: candidate as TypeFilter,
                    label: campaignTypeLabel(candidate),
                    count: byType[candidate],
                  }),
                ),
              ]}
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(value) => {
                refine(() => {
                  setSearch(value)
                })
              }}
              placeholder="Adresse, nom, entreprise ou campagne…"
              label="Rechercher dans l’historique"
              className="min-w-0 flex-1 sm:max-w-sm"
            />

            <Select
              value={campaignId ?? 'all'}
              options={[
                { value: 'all', label: 'Toutes les campagnes' },
                ...launched.map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                })),
              ]}
              onChange={(value) => {
                refine(() => {
                  setCampaignId(value === 'all' ? null : value)
                })
              }}
              label="Filtrer par campagne"
              labelHidden
              className="w-56 max-sm:w-full"
            />

            <Select
              value={outcome}
              options={OUTCOME_OPTIONS}
              onChange={(value) => {
                refine(() => {
                  setOutcome(value)
                })
              }}
              label="Filtrer par résultat"
              labelHidden
              align="end"
              className="w-44"
            />
          </div>

          <p aria-live="polite" className="mt-3 text-[13px] text-ink-muted">
            {countOf(total, 'e-mail')}
            {filtering ? ' correspondent à ce filtre.' : ' au total.'}
          </p>

          {total === 0 ? (
            <EmptyState
              compact
              icon="search"
              title="Aucun résultat"
              description="Aucun envoi ne correspond à votre recherche. Essayez un autre mot, ou retirez un filtre."
              className="mt-4"
              action={
                <Button
                  variant="secondary"
                  icon="close"
                  onClick={() => {
                    refine(() => {
                      setSearch('')
                      setType('all')
                      setOutcome('all')
                      setCampaignId(null)
                    })
                  }}
                >
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <Card className="mt-4 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-xl text-left text-[13px] sm:min-w-2xl">
                  <thead className="border-b border-border bg-surface-2 text-xs text-ink-muted">
                    <tr>
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          aria-label="Tout sélectionner sur cette page"
                          onChange={() => {
                            setSelected((current) => {
                              const next = new Set(current)

                              for (const entry of selectable) {
                                if (allSelected) {
                                  next.delete(entry.contactId!)
                                } else {
                                  next.add(entry.contactId!)
                                }
                              }

                              return next
                            })
                          }}
                          className="size-4 accent-[var(--color-accent)]"
                        />
                      </th>
                      <th className="px-3 py-2.5 font-medium">Contact</th>
                      {/* The company is the widest optional column; on a phone
                          it is what stands between the reader and the result. */}
                      <th className="px-3 py-2.5 font-medium max-sm:hidden">
                        Entreprise
                      </th>
                      <th className="px-3 py-2.5 font-medium">Campagne</th>
                      <th className="px-3 py-2.5 font-medium">Envoyé le</th>
                      <th className="px-3 py-2.5 font-medium">Résultat</th>
                    </tr>
                  </thead>

                  <tbody>
                    {load.state === 'loading' &&
                      Array.from({ length: 6 }, (_, index) => (
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
                      ))}

                    {load.state === 'ready' &&
                      entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-border transition-colors last:border-0 hover:bg-surface-2"
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              disabled={entry.contactId === null}
                              checked={
                                entry.contactId !== null && selected.has(entry.contactId)
                              }
                              aria-label={`Sélectionner ${entry.email ?? 'ce contact'}`}
                              onChange={() => {
                                if (entry.contactId) {
                                  toggle(entry.contactId)
                                }
                              }}
                              className="size-4 accent-[var(--color-accent)] disabled:opacity-40"
                            />
                          </td>

                          <td className="max-w-56 px-3 py-2.5">
                            <span className="block truncate font-medium">
                              {entry.contactName ?? entry.email ?? '—'}
                            </span>
                            {entry.contactName && entry.email && (
                              <span className="block truncate text-xs text-ink-muted">
                                {entry.email}
                              </span>
                            )}
                          </td>

                          <td className="max-w-40 truncate px-3 py-2.5 text-ink-muted max-sm:hidden">
                            {entry.companyName ?? '—'}
                          </td>

                          <td className="max-w-48 px-3 py-2.5">
                            <span className="block truncate">{entry.campaignName}</span>
                            <span className="block truncate text-xs text-ink-subtle">
                              {campaignTypeLabel(entry.campaignType)}
                              {entry.subject && ` · ${entry.subject}`}
                            </span>
                          </td>

                          <td className="tabular px-3 py-2.5 whitespace-nowrap text-ink-muted">
                            {formatDateTime(entry.sentAt)}
                          </td>

                          <td className="px-3 py-2.5">
                            {entry.outcome === 'sent' ? (
                              <Badge tone="success" icon="check">
                                Envoyé
                              </Badge>
                            ) : (
                              <Badge tone="danger" icon="alert">
                                Erreur
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Pagination
            offset={offset}
            limit={PAGE}
            total={total}
            onChange={setOffset}
            label="Pagination de l’historique"
            className="mt-4"
          />
        </>
      )}

      {/* The selection bar: appears only once something is selected, and floats
          above the page so it stays reachable while scrolling a long list. */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl border border-border glass px-4 py-3 shadow-pop">
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
              Tout désélectionner
            </Button>

            <Button
              size="sm"
              variant="primary"
              icon="refresh"
              onClick={() => {
                setCreating(true)
              }}
            >
              Créer une relance
            </Button>
          </div>
        </div>
      )}

      <FollowUpDialog
        open={creating}
        contactIds={[...selected]}
        onClose={() => {
          setCreating(false)
        }}
        onCreated={(campaignId) => {
          setCreating(false)
          setSelected(new Set())
          void navigate(`/campaigns/${campaignId}`)
        }}
      />
    </>
  )
}

/**
 * Turning a selection into a campaign.
 *
 * The contacts are copied server-side from the ids alone, so nothing has to
 * be exported and imported back. The new campaign is a draft of type
 * "relance": it sends nothing until the user writes the message and launches
 * it, which is the only safe default for a list of people who have already
 * been written to once.
 */
function FollowUpDialog({
  open,
  contactIds,
  onClose,
  onCreated,
}: {
  open: boolean
  contactIds: string[]
  onClose: () => void
  onCreated: (campaignId: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // A name that is already almost right: the month is what tells two follow-up
  // runs apart six weeks later.
  const suggested = `Relance — ${new Date().toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })}`

  async function create() {
    setBusy(true)

    try {
      const { campaign, imported } = await campaignsApi.followUp({
        name: (name.trim() || suggested).slice(0, 200),
        contact_ids: contactIds,
      })

      toast.success(`Campagne de relance créée avec ${countOf(imported, 'contact')}.`)
      onCreated(campaign.id)
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'La campagne de relance n’a pas pu être créée.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="refresh"
      title="Créer une campagne de relance"
      description={
        <>
          Les {countOf(contactIds.length, 'contact sélectionné', 'contacts sélectionnés')}{' '}
          seront copiés dans une nouvelle campagne. Rien n’est envoyé : vous écrirez le
          message, puis vous la lancerez.
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
      <TextField
        label="Nom de la campagne"
        value={name}
        maxLength={200}
        placeholder={suggested}
        onChange={(event) => {
          setName(event.target.value)
        }}
        note="Laissez vide pour utiliser le nom proposé."
      />

      <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px shrink-0" />
        <span>
          Une adresse sélectionnée deux fois ne sera copiée qu’une seule fois. La campagne
          sera classée comme <strong className="font-medium text-ink">relance</strong>.
        </span>
      </p>

      {contactIds.length > 200 && (
        <p className="mt-2 text-xs text-ink-muted">
          {formatNumber(contactIds.length)} contacts : la copie peut prendre quelques
          secondes.
        </p>
      )}
    </Modal>
  )
}
