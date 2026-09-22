import { useMemo, useState, type ReactNode } from 'react'

import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import {
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  SEND_WINDOW_LABEL,
  estimateSchedule,
  fitsInOneDay,
  insideSendingWindow,
  nextOpening,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import { countOf, formatDate, formatDays, formatNumber } from '@/services/format'

/**
 * The last screen before real e-mails leave a real mailbox.
 *
 * It states what launching commits to, in the units a person thinks in: how
 * many messages, to whom, starting when, finishing roughly when. Everything
 * here is knowable before the click, and none of it is knowable afterwards —
 * a sent message cannot be recalled, which is the one thing that makes this
 * dialog worth the extra click.
 *
 * The launch can wait for a chosen day and hour (owner's request, 22 September
 * 2026). Only moments the campaign can actually send in are offered: Monday to
 * Saturday, a quarter of an hour at a time from 09:00 to 18:45, on the
 * computer's clock, which the campaign takes as its own. A Sunday picked in
 * the calendar is refused with the reason, not silently moved.
 */

type When = 'now' | 'later'

/** Every quarter of an hour a launch may be scheduled for. */
const TIMES = Array.from(
  { length: (LAST_SEND_HOUR - FIRST_SEND_HOUR + 1) * 4 },
  (_, index) => {
    const hour = FIRST_SEND_HOUR + Math.floor(index / 4)
    const minute = (index % 4) * 15
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    return { value, label: value.replace(':', ' h ') }
  },
)

/** `YYYY-MM-DD` of a date on the browser's calendar, for a date input. */
function dayValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

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
  /** The chosen instant as ISO, or null for as soon as the window allows. */
  onConfirm: (sendAfter: string | null) => void
}) {
  const remaining = remainingOf(campaign)
  const schedule = estimateSchedule(campaign)
  const attachments = campaign.attachments ?? []

  // The first opening from tomorrow: a sensible default for "later".
  const defaultDay = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return dayValue(nextOpening(tomorrow))
  }, [])

  // Read once when the dialog opens: the render itself stays pure.
  const [openedAt] = useState(() => Date.now())
  const [when, setWhen] = useState<When>('now')
  const [day, setDay] = useState(defaultDay)
  const [time, setTime] = useState('09:00')

  const chosen = new Date(`${day}T${time}:00`)
  const problem =
    when === 'later'
      ? Number.isNaN(chosen.getTime())
        ? 'Choisissez une date.'
        : chosen.getTime() <= openedAt
          ? 'Ce moment est déjà passé : choisissez une date à venir.'
          : !insideSendingWindow(chosen)
            ? 'Rien ne part le dimanche : choisissez un jour du lundi au samedi.'
            : null
      : null

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => {
        if (problem) {
          return
        }
        onConfirm(when === 'later' ? chosen.toISOString() : null)
      }}
      busy={busy}
      icon="send"
      size="md"
      title="Lancer cette campagne ?"
      confirmLabel={
        when === 'later'
          ? `Programmer les ${formatNumber(remaining)} envois`
          : `Lancer les ${formatNumber(remaining)} envois`
      }
      description={
        <>
          {countOf(remaining, 'e-mail')} partiront de votre compte Gmail, un par un. Un
          message envoyé ne peut pas être rappelé.
        </>
      }
    >
      <SegmentedControl
        value={when}
        onChange={setWhen}
        label="Quand envoyer"
        className="mb-3 w-full"
        segments={[
          { value: 'now', label: 'Dès que possible', icon: 'send' },
          { value: 'later', label: 'Programmer', icon: 'calendar' },
        ]}
      />

      {when === 'later' && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <TextField
            label="Jour"
            type="date"
            min={dayValue(new Date())}
            value={day}
            onChange={(event) => {
              setDay(event.target.value)
            }}
            error={problem}
          />
          <Select label="Heure" value={time} onChange={setTime} options={TIMES} />
        </div>
      )}

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
          {when === 'later'
            ? problem
              ? '—'
              : `Le ${LONG_DATE.format(chosen)}`
            : startingSentence()}
        </Row>

        {/* A list that fits in one day has no pace to speak of: it all goes
            out in one sitting. */}
        {schedule && !fitsInOneDay(campaign) && (
          <Row label="Durée estimée" icon="calendar">
            {formatDays(schedule.days)} d’envoi, environ{' '}
            {formatNumber(campaign.mailsPerDay)} par jour · fin vers le{' '}
            {formatDate(schedule.lastDay)}
          </Row>
        )}
      </dl>

      <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
        <Icon name="info" size={13} className="mt-px shrink-0" />
        <span>
          Les envois ont lieu {SEND_WINDOW_LABEL}, à l’heure de votre ordinateur. Vous
          pourrez mettre la campagne en pause à tout moment ; le message et les contacts,
          en revanche, ne seront plus modifiables une fois lancée.
        </span>
      </p>
    </ConfirmDialog>
  )
}

/** When the first message goes out if launched now, on the browser's clock. */
function startingSentence(): string {
  const now = new Date()

  if (insideSendingWindow(now)) {
    return 'Dans quelques instants'
  }

  const opens = nextOpening(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  if (opens.toDateString() === now.toDateString()) {
    return 'Aujourd’hui à 9 h 00'
  }

  if (opens.toDateString() === tomorrow.toDateString()) {
    return 'Demain à 9 h 00'
  }

  return `Le ${LONG_DATE.format(opens)} (rien ne part le dimanche)`
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
