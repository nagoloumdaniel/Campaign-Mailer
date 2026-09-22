import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { StackedProgress } from '@/components/ui/Progress'
import { ApiError } from '@/services/api'
import {
  SEND_WINDOW_LABEL,
  campaignsApi,
  fitsInOneDay,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import { countOf, formatDate, formatNumber, formatPercent } from '@/services/format'

import { LaunchDialog } from './LaunchDialog'

/**
 * Where a campaign is, and the one action that makes sense from there.
 *
 * One primary button at a time, chosen by the status, rather than three of
 * which two are disabled: a greyed "Reprendre" beside an enabled "Mettre en
 * pause" asks the reader to work out the state machine before they can act.
 *
 * The blocker is stated next to the button rather than hidden behind it. A
 * disabled "Lancer" with no reason is the most common way an interface makes
 * someone feel stupid.
 */
export function SendControls({
  campaign,
  dirty,
  onChanged,
}: {
  campaign: Campaign
  /** Unsaved edits. Launching would send the stored version, not the one on screen. */
  dirty: boolean
  onChanged: (campaign: Campaign) => void
}) {
  const [busy, setBusy] = useState(false)
  const [launching, setLaunching] = useState(false)

  async function act(
    action: (id: string) => Promise<Campaign>,
    success: string,
  ): Promise<boolean> {
    setBusy(true)

    try {
      onChanged(await action(campaign.id))
      toast.success(success)
      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’action a échoué.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const blocker = launchBlocker(campaign, dirty)
  const done = campaign.sentCount + campaign.errorCount
  const share = campaign.totalContacts > 0 ? done / campaign.totalContacts : 0

  return (
    <Card as="section" aria-labelledby="send-heading" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <h2 id="send-heading" className="text-[15px] font-semibold tracking-tight">
            Envoi
          </h2>
          <p
            aria-live="polite"
            className="mt-1 text-[13px] leading-relaxed text-ink-muted"
          >
            {statusSentence(campaign)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {campaign.status === 'draft' && (
            <Button
              variant="primary"
              icon="send"
              disabled={blocker !== null}
              onClick={() => {
                setLaunching(true)
              }}
            >
              Lancer la campagne…
            </Button>
          )}

          {(campaign.status === 'scheduled' || campaign.status === 'running') && (
            <Button
              variant="secondary"
              icon="pause"
              loading={busy}
              onClick={() => void act(campaignsApi.pause, 'Campagne mise en pause.')}
            >
              Mettre en pause
            </Button>
          )}

          {campaign.status === 'paused' && (
            <Button
              variant="primary"
              icon="play"
              loading={busy}
              onClick={() => void act(campaignsApi.resume, 'Campagne reprise.')}
            >
              Reprendre
            </Button>
          )}
        </div>
      </div>

      {campaign.status === 'draft' && blocker && (
        <p className="flex items-start gap-2 border-t border-border bg-surface-2 px-5 py-3 text-xs text-ink-muted">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          {blocker}
        </p>
      )}

      {ceilingReached(campaign) && (
        // Without this a running campaign that sends nothing looks broken. It
        // is the ceiling doing its job, and it clears by itself.
        <p
          role="status"
          className="flex enter items-start gap-2 border-t border-warning/30 bg-warning-soft px-5 py-3 text-xs leading-relaxed text-warning"
        >
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          <span>
            Plafond du compte atteint :{' '}
            {formatNumber(campaign.sending?.accountSentLast24h ?? 0)} e-mails envoyés sur
            les dernières 24 heures, sur{' '}
            {formatNumber(campaign.sending?.accountDailyLimit ?? 0)} autorisés. L’envoi
            reprend seul dès que la fenêtre se libère ; rien n’est perdu et la campagne
            n’est pas mise en pause.
          </span>
        </p>
      )}

      {campaign.status !== 'draft' && campaign.totalContacts > 0 && (
        <div className="border-t border-border px-5 py-4">
          <StackedProgress
            total={campaign.totalContacts}
            label={`Progression de l’envoi de ${campaign.name}`}
            segments={[
              { value: campaign.sentCount, tone: 'accent', label: 'envoyés' },
              { value: campaign.errorCount, tone: 'danger', label: 'en erreur' },
            ]}
          />

          <p className="tabular mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span className="font-medium text-ink">{formatPercent(share)}</span>
            <span>{formatNumber(campaign.sentCount)} envoyés</span>
            {campaign.errorCount > 0 && (
              <span className="text-danger">
                {formatNumber(campaign.errorCount)} en erreur
              </span>
            )}
            <span>{formatNumber(campaign.totalContacts)} au total</span>
          </p>
        </div>
      )}

      {/* Only a draft can be launched, so only a draft carries the dialog. */}
      {campaign.status === 'draft' && (
        <LaunchDialog
          campaign={campaign}
          open={launching}
          busy={busy}
          onClose={() => {
            setLaunching(false)
          }}
          onConfirm={(sendAfter) => {
            void act(
              (id) => campaignsApi.start(id, sendAfter),
              sendAfter ? 'Campagne programmée.' : 'Campagne lancée.',
            ).then((ok) => {
              if (ok) {
                setLaunching(false)
              }
            })
          }}
        />
      )}
    </Card>
  )
}

/** True when a sending campaign is being held by the account's 24-hour ceiling. */
function ceilingReached(campaign: Campaign): boolean {
  const limit = campaign.sending?.accountDailyLimit

  return (
    (campaign.status === 'running' || campaign.status === 'scheduled') &&
    limit !== undefined &&
    limit !== null &&
    (campaign.sending?.accountSentLast24h ?? 0) >= limit
  )
}

/** Why the campaign cannot be launched yet, in the user's terms; null when it can. */
function launchBlocker(campaign: Campaign, dirty: boolean): string | null {
  if (dirty) {
    // Saving is automatic: this lasts the second it takes.
    return 'Enregistrement de vos modifications…'
  }
  if (!campaign.subject?.trim()) {
    return 'Ajoutez un objet avant de lancer.'
  }
  if (!campaign.bodyHtml?.trim()) {
    return 'Rédigez le message avant de lancer.'
  }
  if (remainingOf(campaign) <= 0) {
    return 'Importez au moins un contact avant de lancer.'
  }
  return null
}

const SCHEDULED = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

function statusSentence(campaign: Campaign): string {
  switch (campaign.status) {
    case 'draft':
      return 'Rien n’est envoyé tant que la campagne n’est pas lancée.'
    case 'scheduled':
      return campaign.sendAfter && Date.parse(campaign.sendAfter) > Date.now()
        ? `Programmée : le premier envoi part le ${SCHEDULED.format(new Date(campaign.sendAfter))}, puis les suivants ${SEND_WINDOW_LABEL}.`
        : `Programmée : les envois commencent à l’ouverture suivante, ${SEND_WINDOW_LABEL}.`
    case 'running':
      return fitsInOneDay(campaign)
        ? `En cours : les messages partent un par un, dans la plage ${SEND_WINDOW_LABEL}.`
        : `En cours : ${countOf(campaign.mailsPerDay, 'message')} par jour au maximum, un par un.`
    case 'paused':
      // The API does not say who paused it. If it was not the user, an expired
      // Google authorization is by far the likeliest reason, and saying so
      // saves a support request.
      return 'En pause : rien ne part. Si ce n’est pas vous qui l’avez mise en pause, reconnectez votre compte Google, puis reprenez.'
    case 'completed':
      return campaign.completedAt
        ? `Terminée le ${formatDate(campaign.completedAt)}.`
        : 'Terminée.'
  }
}
