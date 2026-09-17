import { useCallback, useEffect, useMemo, useState } from 'react'

import { CampaignCard } from '@/components/campaign/CampaignCard'
import { DeleteCampaignDialog } from '@/components/campaign/DeleteCampaignDialog'
import { QuotaAdvice } from '@/components/dashboard/QuotaAdvice'
import { QuotaCard } from '@/components/dashboard/QuotaCard'
import { StatCard } from '@/components/dashboard/StatCard'
import { UpcomingSends } from '@/components/dashboard/UpcomingSends'
import { Sparkline } from '@/components/charts/Sparkline'
import { PageHeader, SectionHeader } from '@/components/layout/PageHeader'
import { DashboardSkeleton } from '@/components/skeletons/PageSkeletons'
import { Button, LinkButton } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { campaignsApi, isActive, remainingOf, type Campaign } from '@/services/campaigns'
import { dashboardApi, type Dashboard as DashboardData } from '@/services/dashboard'
import { countOf, formatNumber } from '@/services/format'
import { campaignsSharingQuota, quotaAdvice } from '@/services/quota'
import { exportCampaignsCsv } from '@/services/exports'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; campaigns: Campaign[]; dashboard: DashboardData }
  | { state: 'failed' }

/**
 * The home page: the whole account in one screen.
 *
 * Ordered the way a user actually asks the questions, not the way the data
 * comes back. How is the account doing, what is about to go out, is anything
 * in my way, what is running, what is done. The advice panel — when several
 * campaigns together ask for more than the day allows — sits directly under
 * the quota it contradicts, because that is the only place where the
 * contradiction is visible.
 *
 * Finished campaigns are folded into a short list at the bottom rather than
 * mixed in with the live ones. They are a record, not a thing to steer, and
 * the full history has its own page.
 */
export function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [toDelete, setToDelete] = useState<Campaign | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [campaigns, dashboard] = await Promise.all([
        campaignsApi.list(),
        dashboardApi.get(),
      ])
      setLoad({ state: 'ready', campaigns, dashboard })
    } catch {
      // A poll that fails keeps what is on screen; only a first load shows the
      // error, because replacing good numbers with an error helps nobody.
      setLoad((current) => (current.state === 'ready' ? current : { state: 'failed' }))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const sending = load.state === 'ready' && load.dashboard.upcoming.length > 0

  /**
   * Follows the account while something is sending, every thirty seconds and
   * only while the tab is visible. Nothing to follow, nothing polled.
   */
  useEffect(() => {
    if (!sending) {
      return
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }, 30_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [sending, refresh])

  const ready = load.state === 'ready' ? load : null

  const groups = useMemo(() => {
    const campaigns = ready?.campaigns ?? []

    return {
      active: campaigns.filter((campaign) => isActive(campaign.status)),
      drafts: campaigns.filter((campaign) => campaign.status === 'draft'),
      completed: campaigns.filter((campaign) => campaign.status === 'completed'),
    }
  }, [ready])

  const advice = useMemo(
    () =>
      ready ? quotaAdvice(ready.campaigns, ready.dashboard.account.dailyLimit) : null,
    [ready],
  )

  if (load.state === 'loading') {
    return <DashboardSkeleton />
  }

  if (load.state === 'failed') {
    return (
      <>
        <PageHeader title="Accueil" />
        <ErrorState
          title="Impossible de charger votre tableau de bord"
          onRetry={() => {
            setLoad({ state: 'loading' })
            void refresh()
          }}
        />
      </>
    )
  }

  const { campaigns, dashboard } = load
  const totals = campaigns.reduce(
    (sum, campaign) => ({
      sent: sum.sent + campaign.sentCount,
      remaining: sum.remaining + remainingOf(campaign),
    }),
    { sent: 0, remaining: 0 },
  )

  const plannedToday = campaignsSharingQuota(campaigns).reduce(
    (sum, campaign) => sum + Math.min(campaign.mailsPerDay, remainingOf(campaign)),
    0,
  )

  return (
    <>
      <PageHeader
        title="Accueil"
        description="Ce que votre compte envoie, ce qu’il lui reste à envoyer, et ce qui part ensuite."
        action={
          <>
            {campaigns.length > 0 && (
              <Button
                variant="secondary"
                icon="download"
                onClick={() => {
                  exportCampaignsCsv(campaigns)
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

      {campaigns.length === 0 ? (
        <EmptyState
          icon="send"
          title="Aucune campagne pour le moment"
          description="Créez une campagne pour rédiger votre message, importer vos contacts et lancer les envois depuis votre propre compte Gmail."
          action={
            <LinkButton to="/campaigns/new" variant="primary" icon="plus">
              Créer une campagne
            </LinkButton>
          }
        />
      ) : (
        <>
          <section aria-label="Chiffres du compte">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                index={0}
                label="Campagnes"
                value={formatNumber(dashboard.campaigns.total)}
                icon="send"
                to="/campaigns"
                detail={
                  [
                    groups.completed.length > 0
                      ? countOf(groups.completed.length, 'terminée')
                      : null,
                    groups.drafts.length > 0
                      ? countOf(groups.drafts.length, 'brouillon')
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
              />
              <StatCard
                index={1}
                label="En cours"
                value={formatNumber(groups.active.length)}
                icon="play"
                tone={groups.active.length > 0 ? 'accent' : 'neutral'}
                detail={
                  dashboard.upcoming.length > 0
                    ? `${countOf(dashboard.upcoming.length, 'envoi')} programmé${dashboard.upcoming.length > 1 ? 's' : ''}`
                    : 'Rien ne part actuellement'
                }
              />
              <StatCard
                index={2}
                label="E-mails envoyés"
                value={formatNumber(totals.sent)}
                icon="mail"
                tone={totals.sent > 0 ? 'success' : 'neutral'}
                detail={`${formatNumber(
                  dashboard.account.perDay.reduce((sum, day) => sum + day.sent, 0),
                )} ces 14 derniers jours`}
                trend={
                  <Sparkline
                    values={dashboard.account.perDay.map((day) => day.sent)}
                    label={`Envois par jour sur 14 jours : ${dashboard.account.perDay
                      .map((day) => String(day.sent))
                      .join(', ')}`}
                    width={84}
                    height={28}
                  />
                }
              />
              <StatCard
                index={3}
                label="Restants à envoyer"
                value={formatNumber(totals.remaining)}
                icon="inbox"
                detail={
                  plannedToday > 0
                    ? `${formatNumber(plannedToday)} prévus aujourd’hui`
                    : 'Aucun envoi prévu'
                }
              />
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <QuotaCard account={dashboard.account} plannedToday={plannedToday} />
            <UpcomingSends upcoming={dashboard.upcoming} campaigns={campaigns} />
          </div>

          {advice && (
            <div className="mt-4">
              <QuotaAdvice
                advice={advice}
                onApplied={(updated) => {
                  // Patched in place rather than refetched: the answer is
                  // already the new campaign, and a reload would blank the
                  // page under a panel the user is still reading.
                  setLoad((current) =>
                    current.state === 'ready'
                      ? {
                          ...current,
                          campaigns: current.campaigns.map(
                            (campaign) =>
                              updated.find((row) => row.id === campaign.id) ?? campaign,
                          ),
                        }
                      : current,
                  )
                  void refresh()
                }}
              />
            </div>
          )}

          {groups.active.length > 0 && (
            <section aria-labelledby="active-heading" className="mt-8">
              <SectionHeader
                id="active-heading"
                title="Campagnes en cours"
                description="Programmées, en cours d’envoi ou en pause."
              />
              <ul className="mt-3 space-y-3">
                {groups.active.map((campaign, index) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    index={Math.min(index, 8)}
                    nextSendAt={
                      dashboard.upcoming.find((item) => item.campaignId === campaign.id)
                        ?.nextSendAt
                    }
                    onDelete={setToDelete}
                  />
                ))}
              </ul>
            </section>
          )}

          {groups.drafts.length > 0 && (
            <section aria-labelledby="drafts-heading" className="mt-8">
              <SectionHeader
                id="drafts-heading"
                title="Brouillons"
                description="Rien n’est envoyé tant qu’une campagne n’est pas lancée."
              />
              <ul className="mt-3 space-y-3">
                {groups.drafts.map((campaign, index) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    index={Math.min(index, 8)}
                    onDelete={setToDelete}
                  />
                ))}
              </ul>
            </section>
          )}

          {groups.completed.length > 0 && (
            <section aria-labelledby="completed-heading" className="mt-8">
              <SectionHeader
                id="completed-heading"
                title="Campagnes terminées"
                description="Le détail de chaque envoi reste consultable dans l’historique."
                action={
                  <LinkButton
                    to="/history"
                    size="sm"
                    variant="ghost"
                    iconAfter="chevron-right"
                  >
                    Voir l’historique
                  </LinkButton>
                }
              />
              <ul className="mt-3 space-y-3">
                {groups.completed.slice(0, 3).map((campaign, index) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    index={Math.min(index, 8)}
                    onDelete={setToDelete}
                  />
                ))}
              </ul>

              {groups.completed.length > 3 && (
                <p className="mt-3 text-center">
                  <LinkButton to="/campaigns" size="sm" variant="ghost">
                    Voir les {formatNumber(groups.completed.length)} campagnes terminées
                  </LinkButton>
                </p>
              )}
            </section>
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
