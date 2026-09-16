import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { AnchorButton, IconButton, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { StackedProgress } from '@/components/ui/Progress'
import {
  campaignsApi,
  isEditable,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import { countOf, formatDate, formatNumber, formatPercent } from '@/services/format'
import { formatNextSend } from '@/services/time'

import { StatusBadge, TypeBadge } from './CampaignBadges'

/**
 * One campaign, in a list.
 *
 * The card shows two different things depending on whether the campaign is
 * still working or has finished, and that is the point rather than an
 * inconsistency: a running campaign is a thing you steer, so it shows the
 * progress and the next send; a finished one is a record, so it shows what it
 * achieved and offers the export. Controls that only make sense while sending
 * are not disabled on a finished campaign, they are absent — a row of greyed
 * buttons asks the reader to work out the state machine.
 */
export function CampaignCard({
  campaign,
  nextSendAt,
  onDelete,
  index = 0,
}: {
  campaign: Campaign
  /** From the dashboard, which already knows it; absent in the plain list. */
  nextSendAt?: string | null | undefined
  onDelete?: ((campaign: Campaign) => void) | undefined
  index?: number
}) {
  const finished = campaign.status === 'completed'
  const attempted = campaign.sentCount + campaign.errorCount
  const remaining = remainingOf(campaign)
  const successRate = attempted > 0 ? campaign.sentCount / attempted : null

  return (
    <Card
      as="li"
      interactive
      className="stagger overflow-hidden"
      // Capped by the caller: past the eighth row nobody is still watching.
      style={{ '--index': index } as CSSProperties}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <Link
              to={`/campaigns/${campaign.id}`}
              className="group flex items-center gap-2 rounded-md"
            >
              <h3 className="truncate text-[15px] font-semibold tracking-tight group-hover:text-accent">
                {campaign.name}
              </h3>
              <Icon
                name="chevron-right"
                size={15}
                className="shrink-0 text-ink-subtle transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </Link>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={campaign.status} />
              <TypeBadge type={campaign.type} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Only a draft can still be written; on anything else the pencil
                would open a page with every field locked. */}
            {isEditable(campaign.status) && (
              <LinkButton
                to={`/campaigns/${campaign.id}`}
                size="sm"
                variant="secondary"
                icon="edit"
              >
                Modifier
              </LinkButton>
            )}

            {attempted > 0 && (
              <AnchorButton
                href={campaignsApi.logsExportUrl(campaign.id)}
                download
                size="sm"
                variant="secondary"
                icon="download"
                className="max-sm:hidden"
              >
                Exporter
              </AnchorButton>
            )}

            {onDelete && campaign.status !== 'running' && (
              <IconButton
                icon="trash"
                label={`Supprimer la campagne ${campaign.name}`}
                size="sm"
                onClick={() => {
                  onDelete(campaign)
                }}
                className="hover:text-danger"
              />
            )}
          </div>
        </div>

        {campaign.totalContacts === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
            <Icon name="users" size={15} />
            Aucun contact importé pour l’instant.
          </p>
        ) : (
          <div className="mt-4">
            <StackedProgress
              total={campaign.totalContacts}
              label={`Progression de ${campaign.name}`}
              segments={[
                { value: campaign.sentCount, tone: 'accent', label: 'envoyés' },
                { value: campaign.errorCount, tone: 'danger', label: 'en erreur' },
              ]}
            />

            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
              <Stat label="Contacts" value={formatNumber(campaign.totalContacts)} />
              <Stat label="Envoyés" value={formatNumber(campaign.sentCount)} />

              {campaign.errorCount > 0 && (
                <Stat
                  label="Erreurs"
                  value={formatNumber(campaign.errorCount)}
                  tone="danger"
                />
              )}

              {finished
                ? successRate !== null && (
                    <Stat label="Taux de réussite" value={formatPercent(successRate)} />
                  )
                : remaining > 0 && (
                    <Stat label="Restants" value={formatNumber(remaining)} />
                  )}
            </dl>
          </div>
        )}

        <p className="mt-3.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <Icon name={finished ? 'check-circle' : 'clock'} size={13} />
          {finished
            ? campaign.completedAt
              ? `Terminée le ${formatDate(campaign.completedAt)}`
              : 'Terminée'
            : nextSendAt
              ? `Prochain envoi ${formatNextSend(new Date(nextSendAt))}`
              : campaign.status === 'draft'
                ? `Créée le ${formatDate(campaign.createdAt)}`
                : `${countOf(campaign.mailsPerDay, 'envoi')} par jour à partir de ${String(campaign.startHour).padStart(2, '0')}:00`}
        </p>
      </div>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd
        className={`tabular font-display text-[15px] font-semibold ${
          tone === 'danger' ? 'text-danger' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
