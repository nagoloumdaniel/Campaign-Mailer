import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Donut } from '@/components/charts/Donut'
import { SendsChart } from '@/components/charts/SendsChart'
import { AnchorButton } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  campaignsApi,
  type Campaign,
  type CampaignStats as Stats,
} from '@/services/campaigns'
import {
  formatDateTime,
  formatDays,
  formatNumber,
  formatPercent,
} from '@/services/format'
import { formatNextSend } from '@/services/time'

/**
 * Where a campaign stands, in three readings of the same data.
 *
 * A ring for the split — every contact is sent, failed, waiting or set aside,
 * and the question a ring answers is how a whole divides. Four figures for the
 * numbers themselves, because an angle is a bad way to read a count. And
 * columns per day for the shape over time, which neither of the other two can
 * show.
 *
 * Three different charts rather than the same one three times: each answers a
 * question the others cannot, and a dashboard where every panel is a bar chart
 * is a dashboard nobody reads past the first panel.
 *
 * Reloads when the campaign's counters move rather than on a timer of its
 * own: the page already follows a sending campaign, and a second poll would
 * ask the same question twice.
 */

type Load = { state: 'loading' } | { state: 'ready'; stats: Stats } | { state: 'failed' }

export function CampaignStats({ campaign }: { campaign: Campaign }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', stats: await campaignsApi.stats(campaign.id) })
    } catch {
      setLoad((current) => (current.state === 'ready' ? current : { state: 'failed' }))
    }
  }, [campaign.id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh, campaign.sentCount, campaign.errorCount, campaign.status])

  return (
    <Card as="section" aria-labelledby="stats-heading" className="p-5">
      <CardHeader
        id="stats-heading"
        title="Statistiques"
        description="Comptées sur le journal d’envoi, pas sur les compteurs de la campagne."
        action={
          <AnchorButton
            href={campaignsApi.logsExportUrl(campaign.id)}
            download
            size="sm"
            variant="secondary"
            icon="download"
          >
            Exporter le journal
          </AnchorButton>
        }
      />

      {load.state === 'loading' && (
        <div role="status" aria-busy="true" className="mt-5">
          <span className="sr-only">Chargement des statistiques</span>
          <div className="flex flex-wrap gap-6">
            <Skeleton className="size-36" rounded="rounded-full" />
            <div className="min-w-48 flex-1 space-y-2.5">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          </div>
          <Skeleton className="mt-6 h-40 w-full" rounded="rounded-xl" />
        </div>
      )}

      {load.state === 'failed' && (
        <ErrorState
          compact
          title="Les statistiques n’ont pas pu être chargées"
          onRetry={() => {
            setLoad({ state: 'loading' })
            void refresh()
          }}
        />
      )}

      {load.state === 'ready' && <Body campaign={campaign} stats={load.stats} />}
    </Card>
  )
}

function Body({ campaign, stats }: { campaign: Campaign; stats: Stats }) {
  const attempted = stats.sent + stats.failed
  const successRate = attempted > 0 ? stats.sent / attempted : null
  const finished = campaign.status === 'completed'

  const duration =
    campaign.startedAt && campaign.completedAt
      ? Math.max(
          1,
          Math.round(
            (Date.parse(campaign.completedAt) - Date.parse(campaign.startedAt)) /
              86_400_000,
          ),
        )
      : null

  return (
    <>
      <div className="mt-5 grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Donut
          total={stats.total}
          centreValue={formatNumber(stats.total)}
          centreLabel="contacts"
          slices={[
            { label: 'Envoyés', value: stats.sent, color: 'var(--color-accent)' },
            { label: 'En erreur', value: stats.failed, color: 'var(--color-danger)' },
            { label: 'En attente', value: stats.pending, color: 'var(--color-series-2)' },
            {
              label: 'Ignorés',
              value: stats.ignored,
              color: 'var(--color-border-strong)',
            },
          ]}
        />

        {/* What the ring cannot say. The four counts are already in its
            legend, beside their own colour; repeating them here as large
            figures made the panel read as two charts of the same thing. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 self-start sm:grid-cols-3">
          <Figure
            label="Taux de réussite"
            value={successRate === null ? '—' : formatPercent(successRate)}
            tone="accent"
            detail={
              attempted > 0 ? `sur ${formatNumber(attempted)} tentatives` : undefined
            }
          />
          <Figure
            label="Taux d’erreur"
            value={stats.errorRate === null ? '—' : formatPercent(stats.errorRate)}
            tone={stats.failed > 0 ? 'danger' : 'neutral'}
            detail={
              stats.failed > 0 ? `${formatNumber(stats.failed)} en erreur` : undefined
            }
          />
          <Figure
            label="Rythme"
            value={formatNumber(campaign.mailsPerDay)}
            detail="e-mails par jour"
          />
        </dl>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-border pt-4 text-[13px] sm:grid-cols-2">
        <Line icon="clock" label="Prochain envoi">
          {stats.nextSendAt ? formatNextSend(new Date(stats.nextSendAt)) : 'Aucun'}
        </Line>

        <Line icon="calendar" label={finished ? 'Durée' : 'Fin estimée'}>
          {finished
            ? duration === null
              ? '—'
              : formatDays(duration)
            : stats.estimatedEndAt
              ? formatNextSend(new Date(stats.estimatedEndAt))
              : '—'}
        </Line>

        <Line icon="send" label="Dernier envoi">
          {stats.lastSentAt ? formatDateTime(stats.lastSentAt) : 'Aucun'}
        </Line>

        <Line icon="play" label="Lancée le">
          {campaign.startedAt ? formatDateTime(campaign.startedAt) : '—'}
        </Line>
      </dl>

      <div className="mt-6 border-t border-border pt-5">
        <SendsChart days={stats.perDay} />
      </div>
    </>
  )
}

function Figure({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string | undefined
  tone?: 'neutral' | 'accent' | 'danger'
}) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd
        className={`tabular mt-0.5 font-display text-xl font-semibold tracking-tight ${
          tone === 'danger'
            ? 'text-danger'
            : tone === 'accent'
              ? 'text-accent'
              : 'text-ink'
        }`}
      >
        {value}
      </dd>
      {detail && <dd className="text-xs text-ink-muted">{detail}</dd>}
    </div>
  )
}

function Line({
  icon,
  label,
  children,
}: {
  icon: 'clock' | 'calendar' | 'send' | 'play'
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="flex items-center gap-1.5 text-ink-muted">
        <Icon name={icon} size={13} />
        {label}
      </dt>
      <dd className="ms-auto font-medium">{children}</dd>
    </div>
  )
}
