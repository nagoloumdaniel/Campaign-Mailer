import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Card, CardHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import {
  PAUSE_MS,
  SEND_WINDOW_LABEL,
  browserTimeZone,
  campaignsApi,
  fitsInOneDay,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import { countOf, formatDays, formatNumber } from '@/services/format'

/**
 * When the messages go out, and how many a day.
 *
 * Almost nothing here is a setting any more (owner's decision, 22 September
 * 2026). The window is Monday to Saturday, 09:00 to 19:00; the pause between
 * two sends is thirty seconds plus jitter, an anti-spam measure a field would
 * only invite shortening; the time zone is the computer's, sent at launch. What
 * is left to choose is the daily pace, and only when the list outlasts a day:
 * a list that fits goes out in one sitting, and a pace field would describe a
 * limit it never meets.
 *
 * The pace saves itself a moment after the last keystroke, like the rest of
 * the campaign. A value out of bounds is shown as an error and not sent.
 */

/** Mirrors the server: 450, below Gmail's own 500. */
const MAX_PER_DAY = 450

/** How long after the last keystroke the pace is saved. */
const SAVE_AFTER_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export function CadencePanel({
  campaign,
  disabled,
  onSaved,
}: {
  campaign: Campaign
  disabled: boolean
  onSaved: (campaign: Campaign) => void
}) {
  const [mailsPerDay, setMailsPerDay] = useState(campaign.mailsPerDay)
  const [save, setSave] = useState<SaveState>('idle')
  const [spreadAsked, setSpreadAsked] = useState(false)
  const paced = !fitsInOneDay(campaign) || spreadAsked

  const remaining = remainingOf(campaign)
  const tooMany = mailsPerDay > MAX_PER_DAY || mailsPerDay < 1
  const days =
    remaining > 0 && mailsPerDay > 0 ? Math.ceil(remaining / mailsPerDay) : null

  /** Roughly how long one day's batch runs, pauses and jitter included. */
  const minutesPerDay = Math.ceil(
    (Math.min(remaining || mailsPerDay, mailsPerDay) * PAUSE_MS * 1.1) / 60_000,
  )

  // Ten hours a day, 09:00 to 19:00: a batch longer than that spills into the
  // next opening, and saying so beforehand beats a progress bar three days on.
  const spills = minutesPerDay > 10 * 60

  // The parent's callback, kept current without restarting the save timer
  // every time the parent renders.
  const latest = useRef(onSaved)
  useEffect(() => {
    latest.current = onSaved
  }, [onSaved])

  useEffect(() => {
    if (disabled || tooMany || mailsPerDay === campaign.mailsPerDay) {
      return
    }

    const timer = window.setTimeout(() => {
      setSave('saving')
      campaignsApi
        .update(campaign.id, { mails_per_day: mailsPerDay })
        .then((updated) => {
          latest.current(updated)
          setSave('saved')
        })
        .catch(() => {
          setSave('failed')
        })
    }, SAVE_AFTER_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [mailsPerDay, campaign.id, campaign.mailsPerDay, disabled, tooMany])

  return (
    <Card as="section" aria-labelledby="cadence-heading" className="p-5">
      <CardHeader
        id="cadence-heading"
        title={paced ? 'Rythme d’envoi' : 'Horaires d’envoi'}
        description="Les messages partent un par un, aux heures de bureau, sans réglage à faire."
      />

      {paced && (
        <div className="mt-5 max-w-xs">
          <TextField
            label="E-mails par jour"
            type="number"
            min={1}
            max={MAX_PER_DAY}
            value={mailsPerDay}
            disabled={disabled}
            onChange={(event) => {
              setMailsPerDay(Number(event.target.value))
              setSave('idle')
            }}
            hint={`max ${String(MAX_PER_DAY)}`}
            {...(tooMany
              ? {
                  error: `Entre 1 et ${String(MAX_PER_DAY)}. Gmail bloque un compte personnel au-delà de 500 envois sur 24 heures.`,
                }
              : {})}
          />
          <p aria-live="polite" className="mt-1.5 text-xs text-ink-muted">
            {save === 'saving'
              ? 'Enregistrement…'
              : save === 'saved'
                ? 'Enregistré'
                : save === 'failed'
                  ? 'Échec de l’enregistrement : modifiez la valeur pour réessayer.'
                  : null}
          </p>
        </div>
      )}

      <ul className="mt-5 space-y-2 border-t border-border pt-4 text-xs leading-relaxed text-ink-muted">
        <Note icon="clock">
          Les envois ont lieu{' '}
          <strong className="font-semibold text-ink">{SEND_WINDOW_LABEL}</strong>, à
          l’heure de votre ordinateur ({browserTimeZone().replace(/_/g, ' ')}). Rien ne
          part le dimanche ni le soir : la suite attend l’ouverture suivante.
        </Note>

        <Note icon="gauge">
          Environ 30 secondes entre deux messages, avec une variation aléatoire : un
          rythme humain, fixé pour protéger votre compte Gmail.
        </Note>

        {!paced && remaining > 0 && (
          <Note icon="calendar">
            Les {countOf(remaining, 'envoi')} restants tiennent dans une seule journée,
            environ {formatNumber(minutesPerDay)} minutes d’envoi.
            {!disabled && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => {
                    setSpreadAsked(true)
                  }}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Répartir sur plusieurs jours
                </button>
              </>
            )}
          </Note>
        )}

        {paced && days !== null && (
          <Note icon="calendar">
            À ce rythme, les {countOf(remaining, 'envoi')} restants prendront environ{' '}
            <strong className="font-semibold text-ink">{formatDays(days)}</strong>{' '}
            d’envoi, à raison d’environ {formatNumber(minutesPerDay)} minutes par jour.
          </Note>
        )}

        {spills && (
          <Note icon="alert" tone="warning">
            Une journée d’envois à ce rythme dépasserait la plage autorisée. Le reste
            partira à l’ouverture suivante, automatiquement.
          </Note>
        )}

        {paced && (
          <Note icon="gauge">
            Le compte est plafonné à {formatNumber(MAX_PER_DAY)} e-mails sur 24 heures,
            toutes campagnes confondues. Une fois atteint, l’envoi attend que la fenêtre
            se libère puis reprend seul.
          </Note>
        )}
      </ul>
    </Card>
  )
}

function Note({
  icon,
  tone = 'muted',
  children,
}: {
  icon: 'clock' | 'calendar' | 'gauge' | 'alert'
  tone?: 'muted' | 'warning'
  children: ReactNode
}) {
  return (
    <li className={`flex items-start gap-2 ${tone === 'warning' ? 'text-warning' : ''}`}>
      <Icon name={icon} size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  )
}
