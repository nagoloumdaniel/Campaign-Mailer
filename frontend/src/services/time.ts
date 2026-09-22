/**
 * Instants as a person reads them: how soon, then when.
 *
 * In the browser's time zone. The campaign's own zone decides when it sends,
 * but the reader wants to know how long they have to wait, on their own clock.
 */

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DAY_AND_TIME = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatNextSend(at: Date, now: Date = new Date()): string {
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000)

  if (minutes < 1) {
    return 'imminent'
  }

  if (minutes < 60) {
    return `dans ${String(minutes)} min`
  }

  if (sameDay(at, now)) {
    return `aujourd’hui à ${TIME.format(at)}`
  }

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (sameDay(at, tomorrow)) {
    return `demain à ${TIME.format(at)}`
  }

  return `le ${DAY_AND_TIME.format(at)}`
}

const DAY_AND_HOUR = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * The calendar day and hour, beside the relative time rather than instead of
 * it.
 *
 * "dans 12 min" is what a person wants at a glance; it stops being useful the
 * moment the answer is "demain", and then the date is what they act on.
 */
export function formatSendDay(at: Date, now: Date = new Date()): string {
  return sameDay(at, now) ? TIME.format(at) : DAY_AND_HOUR.format(at)
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A countdown: "04:07" under an hour, "2 h 05" under a day, "1 j 3 h" beyond.
 * Seconds only where they still move the reading.
 */
export function formatLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours >= 24) {
    return `${String(Math.floor(hours / 24))} j ${String(hours % 24)} h`
  }

  if (hours >= 1) {
    return `${String(hours)} h ${pad(minutes % 60)}`
  }

  return `${pad(minutes)}:${pad(seconds % 60)}`
}
