import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Select } from '@/components/ui/Select'
import { ApiError } from '@/services/api'
import {
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  SEND_WINDOW_LABEL,
  campaignsApi,
  fitsInOneDay,
  remainingOf,
  type Campaign,
} from '@/services/campaigns'
import { countOf, formatDays, formatHour, formatNumber } from '@/services/format'

/**
 * How fast, from what hour, in whose day.
 *
 * Three rules are enforced here because breaking any of them has a cost
 * outside the application:
 *
 *   * at most 450 a day. Google blocks a personal Gmail account past 500
 *     messages over a rolling 24 hours, and what the user sends by hand from
 *     the same mailbox counts too.
 *   * at least ten seconds between two sends. A burst is what gets an account
 *     flagged; the pace of a person writing is what does not.
 *   * office hours only, 10:00 to 17:59 on the campaign's own clock. That one
 *     is about how the message is received rather than about Gmail: a
 *     candidature landing at three in the morning reads as automated, and a
 *     recipient who answers it finds the sender asleep.
 *
 * The consequence of the third rule is the thing users get wrong, so it is
 * spelled out rather than left to be discovered: a campaign launched after
 * 17:59 sends nothing that evening and starts the next morning.
 */

/** Mirrors the server: 450, below Gmail's own 500. */
const MAX_PER_DAY = 450
const MIN_PAUSE_SECONDS = 10
const MAX_PAUSE_SECONDS = 600

const HOURS = Array.from({ length: LAST_SEND_HOUR - FIRST_SEND_HOUR + 1 }, (_, index) => {
  const hour = FIRST_SEND_HOUR + index
  return { value: String(hour), label: formatHour(hour) }
})

function timeZones(): { value: string; label: string }[] {
  try {
    return Intl.supportedValuesOf('timeZone').map((zone) => ({
      value: zone,
      label: zone.replace(/_/g, ' '),
    }))
  } catch {
    // An older engine without the list still has to let the user keep theirs.
    return [
      { value: 'Europe/Paris', label: 'Europe/Paris' },
      { value: 'UTC', label: 'UTC' },
    ]
  }
}

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
  const [startHour, setStartHour] = useState(campaign.startHour)
  const [pauseSeconds, setPauseSeconds] = useState(Math.round(campaign.pauseMs / 1000))
  const [timezone, setTimezone] = useState(campaign.timezone)
  const [saving, setSaving] = useState(false)
  /**
   * A list that fits under the daily pace goes out in one day, and the pace
   * fields describe a limit it will never meet: they stay folded until the
   * user asks to spread the list out on purpose.
   */
  const [spreadAsked, setSpreadAsked] = useState(false)
  const paced = !fitsInOneDay(campaign) || spreadAsked

  const zones = useMemo(() => {
    const list = timeZones()
    // A campaign saved with a zone this engine does not list must still be
    // able to keep it, so it is added rather than silently replaced.
    return list.some((zone) => zone.value === timezone)
      ? list
      : [{ value: timezone, label: timezone }, ...list]
  }, [timezone])

  const remaining = remainingOf(campaign)
  const days =
    remaining > 0 && mailsPerDay > 0 ? Math.ceil(remaining / mailsPerDay) : null

  const tooMany = mailsPerDay > MAX_PER_DAY || mailsPerDay < 1
  const tooFast = pauseSeconds < MIN_PAUSE_SECONDS || pauseSeconds > MAX_PAUSE_SECONDS

  const changed =
    mailsPerDay !== campaign.mailsPerDay ||
    startHour !== campaign.startHour ||
    pauseSeconds !== Math.round(campaign.pauseMs / 1000) ||
    timezone !== campaign.timezone

  /** Roughly how long one day's batch runs, pauses and jitter included. */
  const minutesPerDay = Math.ceil(
    (Math.min(remaining || mailsPerDay, mailsPerDay) * pauseSeconds * 1.1) / 60,
  )

  // The window is eight hours wide; a batch that needs longer than that will
  // spill into the next morning, and saying so beforehand is cheaper than
  // letting the user work it out from a progress bar three days later.
  const spills = minutesPerDay > (LAST_SEND_HOUR + 1 - startHour) * 60

  async function save() {
    setSaving(true)

    try {
      onSaved(
        await campaignsApi.update(campaign.id, {
          mails_per_day: mailsPerDay,
          start_hour: startHour,
          pause_ms: pauseSeconds * 1000,
          timezone,
        }),
      )
      toast.success('Rythme d’envoi enregistré.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’enregistrement a échoué.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="cadence-heading" className="p-5">
      <CardHeader
        id="cadence-heading"
        title={paced ? 'Rythme d’envoi' : 'Horaires d’envoi'}
        description="Les messages partent un par un, pendant les heures de bureau du fuseau choisi."
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {paced && (
          <TextField
            label="E-mails par jour"
            type="number"
            min={1}
            max={MAX_PER_DAY}
            value={mailsPerDay}
            disabled={disabled}
            onChange={(event) => {
              setMailsPerDay(Number(event.target.value))
            }}
            hint={`max ${String(MAX_PER_DAY)}`}
            {...(tooMany
              ? {
                  error: `Entre 1 et ${String(MAX_PER_DAY)}. Gmail bloque un compte personnel au-delà de 500 envois sur 24 heures.`,
                }
              : {})}
          />
        )}

        <Select
          value={String(startHour)}
          options={HOURS}
          onChange={(value) => {
            setStartHour(Number(value))
          }}
          label="Heure de départ"
          disabled={disabled}
        />

        <TextField
          label="Pause entre deux envois"
          type="number"
          min={MIN_PAUSE_SECONDS}
          max={MAX_PAUSE_SECONDS}
          value={pauseSeconds}
          disabled={disabled}
          onChange={(event) => {
            setPauseSeconds(Number(event.target.value))
          }}
          hint="secondes"
          {...(tooFast
            ? {
                error: `Entre ${String(MIN_PAUSE_SECONDS)} et ${String(MAX_PAUSE_SECONDS)} secondes : des envois en rafale font repérer le compte.`,
              }
            : {})}
        />

        <Select
          value={timezone}
          options={zones}
          onChange={setTimezone}
          label="Fuseau horaire"
          disabled={disabled}
          align="end"
        />
      </div>

      <ul className="mt-5 space-y-2 border-t border-border pt-4 text-xs leading-relaxed text-ink-muted">
        <Note icon="clock">
          Les envois ont lieu entre{' '}
          <strong className="font-semibold text-ink">{SEND_WINDOW_LABEL}</strong>, heure
          de {timezone.replace(/_/g, ' ')}. Une campagne lancée en dehors de cette plage
          commence le lendemain à {formatHour(startHour)} — rien ne part le soir même.
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
            <strong className="font-semibold text-ink">{formatDays(days)}</strong>, à
            raison d’environ {formatNumber(minutesPerDay)} minutes d’envoi par jour.
          </Note>
        )}

        {spills && (
          <Note icon="alert" tone="warning">
            Une journée d’envois à ce rythme dépasserait la plage autorisée. Le reste sera
            envoyé le lendemain matin, automatiquement.
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

      {!disabled && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            icon="check"
            loading={saving}
            disabled={tooMany || tooFast || !changed}
            onClick={() => void save()}
          >
            Enregistrer le rythme
          </Button>
          <span aria-live="polite" className="text-xs text-ink-muted">
            {changed ? 'Modifications non enregistrées' : 'À jour'}
          </span>
        </div>
      )}
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
