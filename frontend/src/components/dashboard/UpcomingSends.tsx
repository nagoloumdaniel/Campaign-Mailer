import { Link } from 'react-router-dom'

import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/Icon'
import type { Campaign } from '@/services/campaigns'
import { formatNumber } from '@/services/format'
import type { UpcomingSend } from '@/services/dashboard'
import { formatNextSend, formatSendDay } from '@/services/time'

import { StatusBadge } from '../campaign/CampaignBadges'

/**
 * What goes out next, soonest first.
 *
 * The question this answers is "what is about to happen from my mailbox",
 * which is why it leads with the time rather than with the campaign: a user
 * checking the dashboard in the morning is looking for the next thing, not
 * for a directory of campaigns.
 *
 * "dans 12 min" and the day it falls on are both there. The first is what a
 * person wants at a glance; the second is what they need when the answer is
 * "demain", because a relative time alone stops being useful past a few
 * hours.
 */
export function UpcomingSends({
  upcoming,
  campaigns,
}: {
  upcoming: UpcomingSend[]
  /** Looked up for the day's pace, which the dashboard payload does not carry. */
  campaigns: Campaign[]
}) {
  return (
    <Card as="section" aria-labelledby="upcoming-heading" className="flex flex-col p-5">
      <CardHeader
        id="upcoming-heading"
        title="Prochains envois"
        description="Les campagnes programmées ou en cours, dans l’ordre où elles partiront."
      />

      {upcoming.length === 0 ? (
        <EmptyState
          compact
          icon="clock"
          title="Rien de prévu pour l’instant"
          description="Une campagne lancée apparaît ici avec la date et l’heure de son prochain envoi."
          className="mt-4 flex-1"
        />
      ) : (
        <ul className="mt-2 flex-1 divide-y divide-border">
          {upcoming.map((item) => {
            const campaign = campaigns.find(
              (candidate) => candidate.id === item.campaignId,
            )

            return (
              <li key={item.campaignId}>
                <Link
                  to={`/campaigns/${item.campaignId}`}
                  className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-2"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
                  >
                    <Icon name="send" size={16} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[13px] font-semibold">
                        {item.name}
                      </span>
                      <StatusBadge status={item.status} />
                    </span>

                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {formatNumber(item.pending)} en attente
                      {campaign && ` · ${formatNumber(campaign.mailsPerDay)} par jour`}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-medium whitespace-nowrap">
                      {item.nextSendAt
                        ? formatNextSend(new Date(item.nextSendAt))
                        : 'Rien à envoyer'}
                    </span>
                    {item.nextSendAt && (
                      <span className="tabular mt-0.5 block text-xs whitespace-nowrap text-ink-subtle">
                        {formatSendDay(new Date(item.nextSendAt))}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
