/**
 * How numbers, dates and files are written, in one place.
 *
 * Every formatter is built once at module load rather than per render:
 * `Intl.DateTimeFormat` is expensive to construct and free to reuse, and a
 * table of two hundred rows constructs it two hundred times otherwise.
 */

const NUMBER = new Intl.NumberFormat('fr-FR')
const PERCENT = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
})
const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const DATE_LONG = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function formatNumber(value: number): string {
  return NUMBER.format(value)
}

export function formatPercent(ratio: number): string {
  return PERCENT.format(ratio)
}

export function formatDateShort(value: string | Date): string {
  return DATE_SHORT.format(new Date(value))
}

export function formatDate(value: string | Date): string {
  return DATE_LONG.format(new Date(value))
}

export function formatDateTime(value: string | Date): string {
  return DATE_TIME.format(new Date(value))
}

export function formatTime(value: string | Date): string {
  return TIME.format(new Date(value))
}

/** `10:00`, from the hour a campaign starts at. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** A file size a person reads, not a byte count. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return '—'
  }

  if (bytes < 1024) {
    return `${String(bytes)} o`
  }

  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))} Ko`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * A plural that agrees, without a template at every call site.
 *
 * French pluralises from two, so "1 envoi" and "0 envoi" both take the
 * singular — which `value > 1` gets right and `value !== 1` does not.
 */
export function plural(value: number, singular: string, pluralForm?: string): string {
  return value > 1 ? (pluralForm ?? `${singular}s`) : singular
}

export function countOf(value: number, singular: string, pluralForm?: string): string {
  return `${formatNumber(value)} ${plural(value, singular, pluralForm)}`
}

/** A duration in days, as a sentence fragment. */
export function formatDays(days: number): string {
  if (days <= 0) {
    return 'moins d’un jour'
  }

  return `${String(days)} ${plural(days, 'jour')}`
}
