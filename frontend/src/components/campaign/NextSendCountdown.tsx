import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { Progress } from '@/components/ui/Progress'
import { formatLeft, formatSendDay } from '@/services/time'

/**
 * The time left before the next message leaves, counted down every second.
 *
 * A date alone ("aujourd'hui à 10:00") answers when; what a user watching a
 * campaign wants is how long, and whether it is still on track. So the bar
 * fills from the last send — or from the moment the page opened, before the
 * first — to the planned one, and the figure beside it counts the seconds.
 *
 * The instant comes from the server, which reads the time the planner wrote
 * for the queued job: it is the real time of the send, not an estimate. When it
 * is reached the component says the send is under way and asks its parent to
 * read the campaign again, which brings the next one.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** The send takes a moment; reading again at once would find it still pending. */
const REFRESH_AFTER_DUE_MS = 2000

export function NextSendCountdown({
  at,
  from,
  onDue,
  compact = false,
  className = '',
}: {
  /** ISO instant of the next send. */
  at: string
  /** ISO instant of the previous send, where the bar starts. */
  from?: string | null | undefined
  /** Called once, shortly after the instant passes. */
  onDue?: (() => void) | undefined
  compact?: boolean
  className?: string
}) {
  const [openedAt] = useState(() => Date.now())
  const now = useNow(1000)
  const target = Date.parse(at)

  // The bar starts at the previous send when there is one, never more than a
  // day back: a bar that has been filling for a week moves too slowly to read.
  const previous = from ? Date.parse(from) : Number.NaN
  const start = Math.max(
    target - DAY_MS,
    Number.isFinite(previous) && previous < target
      ? previous
      : Math.min(openedAt, target),
  )

  const left = target - now
  const due = left <= 0

  const notified = useRef<string | null>(null)
  useEffect(() => {
    if (!due || !onDue || notified.current === at) {
      return
    }

    notified.current = at
    const timer = window.setTimeout(onDue, REFRESH_AFTER_DUE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [due, onDue, at])

  const span = Math.max(1, target - start)
  const elapsed = Math.min(span, Math.max(0, now - start))

  return (
    <div className={className}>
      <div
        className={`flex items-baseline justify-between gap-3 ${compact ? 'text-xs' : 'text-[13px]'}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
          <Icon
            name={due ? 'send' : 'clock'}
            size={compact ? 12 : 14}
            className={due ? 'text-accent' : ''}
          />
          <span className="truncate">
            {due
              ? 'Envoi en cours…'
              : `Prochain envoi à ${formatSendDay(new Date(target))}`}
          </span>
        </span>

        {!due && (
          <span
            role="timer"
            aria-label={`Prochain envoi dans ${spokenLeft(left)}`}
            className={`tabular shrink-0 font-semibold text-ink ${compact ? '' : 'font-display text-[15px]'}`}
          >
            {formatLeft(left)}
          </span>
        )}
      </div>

      <Progress
        value={elapsed}
        max={span}
        size={compact ? 'sm' : 'md'}
        label="Temps écoulé avant le prochain envoi"
        className={`mt-2 ${due ? 'animate-pulse motion-reduce:animate-none' : ''}`}
      />
    </div>
  )
}

/** The current time, updated every `stepMs`. */
function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, stepMs)

    return () => {
      window.clearInterval(timer)
    }
  }, [stepMs])

  return now
}

/** The time left, as a sentence a screen reader can say. */
function spokenLeft(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))

  if (minutes < 1) {
    return 'moins d’une minute'
  }

  const hours = Math.floor(minutes / 60)
  return hours > 0
    ? `${String(hours)} heure${hours > 1 ? 's' : ''} ${String(minutes % 60)} minutes`
    : `${String(minutes)} minute${minutes > 1 ? 's' : ''}`
}
