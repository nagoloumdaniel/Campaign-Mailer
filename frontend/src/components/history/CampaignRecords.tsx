import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge, TypeBadge } from '@/components/campaign/CampaignBadges'
import { Card, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { Progress } from '@/components/ui/Progress'
import type { Campaign } from '@/services/campaigns'
import { formatDate, formatNumber, formatPercent } from '@/services/format'

/**
 * The campaigns that have sent, with what each achieved: the first thing the
 * history shows (owner's request, 22 September 2026). The question a user
 * brings here is "how did my campaigns go", which a list of addresses cannot
 * answer at a glance; the send log below stays for the detail, and a click on
 * a campaign filters it to that campaign.
 *
 * The figures are the campaign's own counters: what left, what failed, the
 * share that went through. Drafts have sent nothing and are left out.
 */

type Sort = 'started' | 'name' | 'sent' | 'success'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'started', label: 'Lancée le' },
  { value: 'name', label: 'Campagne' },
  { value: 'sent', label: 'Envoyés' },
  { value: 'success', label: 'Réussite' },
]

function successOf(campaign: Campaign): number | null {
  const attempted = campaign.sentCount + campaign.errorCount
  return attempted > 0 ? campaign.sentCount / attempted : null
}

export function CampaignRecords({
  campaigns,
  selectedId,
  onSelect,
}: {
  campaigns: readonly Campaign[]
  /** The campaign the send log is filtered to, if any. */
  selectedId: string | null
  onSelect: (campaignId: string | null) => void
}) {
  const [sort, setSort] = useState<Sort>('started')
  const [descending, setDescending] = useState(true)

  const rows = useMemo(() => {
    const launched = campaigns.filter((campaign) => campaign.status !== 'draft')
    const key = (campaign: Campaign): number | string => {
      switch (sort) {
        case 'name':
          return campaign.name.toLocaleLowerCase('fr')
        case 'sent':
          return campaign.sentCount
        case 'success':
          return successOf(campaign) ?? -1
        case 'started':
          return Date.parse(
            campaign.startedAt ?? campaign.scheduledAt ?? campaign.createdAt,
          )
      }
    }

    return [...launched].sort((a, b) => {
      const [x, y] = [key(a), key(b)]
      const order = x < y ? -1 : x > y ? 1 : 0
      return descending ? -order : order
    })
  }, [campaigns, sort, descending])

  const totals = rows.reduce(
    (sum, campaign) => ({
      sent: sum.sent + campaign.sentCount,
      failed: sum.failed + campaign.errorCount,
    }),
    { sent: 0, failed: 0 },
  )
  const overall =
    totals.sent + totals.failed > 0 ? totals.sent / (totals.sent + totals.failed) : null

  function sortBy(column: Sort) {
    if (column === sort) {
      setDescending((current) => !current)
    } else {
      setSort(column)
      // Names read A to Z; figures and dates read largest and latest first.
      setDescending(column !== 'name')
    }
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <Card as="section" aria-labelledby="records-heading" className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader
          id="records-heading"
          title="Vos campagnes"
          description="Ce que chaque campagne lancée a envoyé. Cliquez sur une campagne pour voir ses envois."
        />

        <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
          <Figure label="Campagnes lancées" value={formatNumber(rows.length)} />
          <Figure label="E-mails envoyés" value={formatNumber(totals.sent)} />
          <Figure
            label="Taux de réussite"
            value={overall === null ? '—' : formatPercent(overall)}
          />
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-xl text-left text-[13px] md:min-w-3xl">
          <thead className="border-y border-border bg-surface-2 text-xs text-ink-muted">
            <tr>
              {SORTS.map((column) => (
                <th
                  key={column.value}
                  scope="col"
                  aria-sort={
                    sort === column.value
                      ? descending
                        ? 'descending'
                        : 'ascending'
                      : 'none'
                  }
                  className={`px-3 py-2.5 font-medium ${column.value === 'started' ? 'max-md:hidden' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      sortBy(column.value)
                    }}
                    className={`-mx-1 inline-flex items-center gap-1 rounded-md px-1 whitespace-nowrap hover:text-ink ${sort === column.value ? 'text-ink' : ''}`}
                  >
                    {column.label}
                    <Icon
                      name="chevron-down"
                      size={12}
                      className={`transition-transform duration-150 ${sort === column.value ? '' : 'opacity-0'} ${sort === column.value && !descending ? 'rotate-180' : ''}`}
                    />
                  </button>
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 font-medium max-sm:hidden">
                Erreurs
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((campaign) => {
              const success = successOf(campaign)
              const active = campaign.id === selectedId

              return (
                <tr
                  key={campaign.id}
                  aria-selected={active}
                  onClick={() => {
                    onSelect(active ? null : campaign.id)
                  }}
                  className={`cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2 ${active ? 'bg-accent-soft/50' : ''}`}
                >
                  <td className="tabular px-3 py-3 whitespace-nowrap text-ink-muted max-md:hidden">
                    {formatDate(
                      campaign.startedAt ?? campaign.scheduledAt ?? campaign.createdAt,
                    )}
                  </td>
                  <td className="max-w-64 px-3 py-3">
                    <Link
                      to={`/campaigns/${campaign.id}`}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                      className="block truncate font-medium hover:text-accent hover:underline"
                    >
                      {campaign.name}
                    </Link>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <TypeBadge type={campaign.type} />
                      <StatusBadge status={campaign.status} />
                    </span>
                  </td>
                  <td className="tabular px-3 py-3 whitespace-nowrap">
                    <span className="font-medium">
                      {formatNumber(campaign.sentCount)}
                    </span>
                    <span className="text-ink-subtle">
                      {' '}
                      / {formatNumber(campaign.totalContacts)}
                    </span>
                  </td>
                  <td className="min-w-28 px-3 py-3">
                    {success === null ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      <>
                        <span className="tabular text-xs font-medium">
                          {formatPercent(success)}
                        </span>
                        <Progress
                          value={success * 100}
                          size="sm"
                          tone={
                            success >= 0.95
                              ? 'success'
                              : success >= 0.8
                                ? 'warning'
                                : 'danger'
                          }
                          label={`Taux de réussite de ${campaign.name}`}
                          className="mt-1"
                        />
                      </>
                    )}
                  </td>
                  <td
                    className={`tabular px-3 py-3 max-sm:hidden ${campaign.errorCount > 0 ? 'text-danger' : 'text-ink-subtle'}`}
                  >
                    {formatNumber(campaign.errorCount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-display text-lg font-semibold">{value}</dd>
    </div>
  )
}
