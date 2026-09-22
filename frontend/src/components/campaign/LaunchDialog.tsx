import type { ReactNode } from 'react'

import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/Modal'
import {
  LAST_SEND_HOUR,
  SEND_WINDOW_LABEL,
  estimateSchedule,
  fitsInOneDay,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import {
  countOf,
  formatDate,
  formatDays,
  formatHour,
  formatNumber,
} from '@/services/format'

/**
 * The last screen before real e-mails leave a real mailbox.
 *
 * It states what launching commits to, in the units a person thinks in: how
 * many messages, to whom, starting when, finishing roughly when. Everything
 * here is knowable before the click, and none of it is knowable afterwards —
 * a sent message cannot be recalled, which is the one thing that makes this
 * dialog worth the extra click.
 *
 * The starting line is the one that surprises people, so it is computed
 * rather than described: launched at 18:30, a campaign says "demain à 10:00",
 * not "dès maintenant".
 */
export function LaunchDialog({
  campaign,
  open,
  busy,
  onClose,
  onConfirm,
}: {
  campaign: Campaign
  open: boolean
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const remaining = remainingOf(campaign)
  const schedule = estimateSchedule(campaign)
  const attachments = campaign.attachments ?? []

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      busy={busy}
      icon="send"
      size="md"
      title="Lancer cette campagne ?"
      confirmLabel={`Lancer les ${formatNumber(remaining)} envois`}
      description={
        <>
          {countOf(remaining, 'e-mail')} partiront de votre compte Gmail, un par un. Un
          message envoyé ne peut pas être rappelé.
        </>
      }
    >
      <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border text-[13px]">
        <Row label="Destinataires" icon="users">
          {countOf(remaining, 'contact')} en attente
          {campaign.sentCount > 0 &&
            ` · ${formatNumber(campaign.sentCount)} déjà envoyés`}
        </Row>

        <Row label="Objet" icon="mail">
          <span className="truncate">{campaign.subject ?? '—'}</span>
        </Row>

        <Row label="Pièces jointes" icon="paperclip">
          {attachments.length === 0
            ? 'Aucune'
            : attachments.map((file) => file.name).join(', ')}
        </Row>

        <Row label="Premier envoi" icon="clock">
          {startingSentence(campaign)}
        </Row>

        {/* A list that fits in one day has no pace to speak of: it all goes
            out in one sitting. */}
        {schedule && !fitsInOneDay(campaign) && (
          <Row label="Durée estimée" icon="calendar">
            {formatDays(schedule.days)}, environ {formatNumber(campaign.mailsPerDay)} par
            jour · fin vers le {formatDate(schedule.lastDay)}
          </Row>
        )}
      </dl>

      <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px shrink-0" />
        <span>
          Vous pourrez mettre la campagne en pause à tout moment. Le message et les
          contacts, en revanche, ne seront plus modifiables une fois lancée.
        </span>
      </p>
    </ConfirmDialog>
  )
}

/**
 * When the first message actually goes out.
 *
 * Read from the browser's clock against the campaign's own hours, which is an
 * approximation when the two are in different zones — and said as one, with
 * the zone named, rather than stated as a fact the worker might contradict.
 */
function startingSentence(campaign: Campaign): string {
  const hourNow = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: campaign.timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  )

  const zone = campaign.timezone.replace(/_/g, ' ')

  if (hourNow < campaign.startHour) {
    return `Aujourd’hui à ${formatHour(campaign.startHour)} (${zone})`
  }

  if (hourNow > LAST_SEND_HOUR) {
    // The window closed for today. Nothing goes out this evening, whatever
    // the start hour says.
    return `Demain à ${formatHour(campaign.startHour)} (${zone}) — la plage ${SEND_WINDOW_LABEL} est passée`
  }

  return `Dans quelques instants (${zone})`
}

function Row({
  label,
  icon,
  children,
}: {
  label: string
  icon: 'users' | 'mail' | 'paperclip' | 'clock' | 'calendar'
  children: ReactNode
}) {
  return (
    <div className="flex gap-3 px-3.5 py-2.5">
      <dt className="flex w-32 shrink-0 items-center gap-1.5 text-ink-muted">
        <Icon name={icon} size={13} />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 font-medium">{children}</dd>
    </div>
  )
}
