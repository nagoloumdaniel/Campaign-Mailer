import { useId, useState } from 'react'

import type { DaySends } from '@/services/campaigns'
import { continuousDays, niceMax } from '@/services/chartScale'
import { countOf } from '@/services/format'

/**
 * Sends per day, as stacked columns: sent at the base, failures on top.
 *
 * Plain HTML and CSS rather than a charting library. It is one chart of at
 * most thirty columns, and a library would add more weight to the bundle than
 * the rest of this page — and would then have to be taught the theme, which
 * these colours get for free by being theme tokens.
 *
 * Every column is a button, so the values are reachable from a keyboard and
 * announced one by one; the figures are also laid out as a table underneath,
 * behind a disclosure, for anyone who would rather read them than hover.
 */

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function dayLabel(day: string): string {
  return DAY_LABEL.format(new Date(`${day}T00:00:00Z`))
}

function describe(day: DaySends): string {
  const sent = countOf(day.sent, 'envoyé')
  return day.failed > 0
    ? `${dayLabel(day.day)} : ${sent}, ${countOf(day.failed, 'erreur')}`
    : `${dayLabel(day.day)} : ${sent}`
}

export function SendsChart({ days }: { days: readonly DaySends[] }) {
  const series = continuousDays(days)
  const [active, setActive] = useState<number | null>(null)
  const titleId = useId()

  if (series.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-muted">
        Aucun envoi pour l’instant. Le graphique se remplit au premier message parti.
      </p>
    )
  }

  const max = niceMax(Math.max(...series.map((day) => day.sent + day.failed)))
  const hasFailures = series.some((day) => day.failed > 0)
  // Label every k-th day so the axis never collides, and always the last one.
  const every = Math.ceil(series.length / 7)
  const activeDay = active === null ? undefined : series.at(active)
  const lastIndex = series.length - 1

  /**
   * The last day always gets its label; a thinned label too close to it is
   * dropped rather than left to overlap it, which at 375px it would.
   */
  const showLabel = (index: number) =>
    index === lastIndex ||
    (index % every === 0 && lastIndex - index >= Math.ceil(every / 2))

  /** Kept off the edges, so the tooltip of the first or last column stays on screen. */
  const tooltipLeft =
    active === null
      ? 0
      : Math.min(85, Math.max(15, ((active + 0.5) / series.length) * 100))

  return (
    <figure aria-labelledby={titleId} className="m-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={titleId} className="text-[13px] font-medium">
          Envois par jour
        </figcaption>

        {/* Two series, so a legend; identity is never colour alone. */}
        <ul className="flex gap-4 text-xs text-ink-muted">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-accent" />
            Envoyés
          </li>
          {hasFailures && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm bg-danger" />
              En erreur
            </li>
          )}
        </ul>
      </div>

      <div className="relative mt-3 flex gap-2">
        {/* Y axis: three clean ticks, text in ink, never in a series colour. */}
        <div
          aria-hidden
          className="tabular flex h-40 w-8 shrink-0 flex-col justify-between text-right text-[11px] text-ink-subtle"
        >
          <span className="-translate-y-1/2">{max}</span>
          <span>{max / 2}</span>
          <span className="translate-y-1/2">0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Hairline gridlines, recessive; the baseline one step stronger. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40">
            <div className="absolute inset-x-0 top-0 border-t border-border" />
            <div className="absolute inset-x-0 top-1/2 border-t border-border" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border-strong" />
          </div>

          <ol className="relative flex h-40 items-end">
            {series.map((day, index) => {
              const total = day.sent + day.failed
              const height = (total / max) * 100

              return (
                <li key={day.day} className="flex h-full flex-1 justify-center">
                  {/* The whole column is the hit target, not the painted bar. */}
                  <button
                    type="button"
                    aria-label={describe(day)}
                    onPointerEnter={() => {
                      setActive(index)
                    }}
                    onPointerLeave={() => {
                      setActive(null)
                    }}
                    onFocus={() => {
                      setActive(index)
                    }}
                    onBlur={() => {
                      setActive(null)
                    }}
                    className="group flex h-full w-full cursor-default items-end justify-center rounded-sm focus-visible:outline-offset-0"
                  >
                    <span
                      className="flex w-full max-w-6 flex-col gap-0.5 transition-[height,opacity] duration-500 ease-out group-hover:opacity-80 motion-reduce:transition-none"
                      style={{ height: `${String(height)}%` }}
                    >
                      {day.failed > 0 && (
                        <span
                          className="rounded-t-sm bg-danger"
                          style={{ flexGrow: day.failed }}
                        />
                      )}
                      {day.sent > 0 && (
                        <span
                          className={`bg-accent ${day.failed > 0 ? '' : 'rounded-t-sm'}`}
                          style={{ flexGrow: day.sent }}
                        />
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <ol aria-hidden className="mt-1.5 flex text-[11px] text-ink-subtle">
            {series.map((day, index) => (
              <li key={day.day} className="flex-1 text-center whitespace-nowrap">
                {showLabel(index) ? dayLabel(day.day) : ''}
              </li>
            ))}
          </ol>

          {activeDay && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop"
              style={{ left: `${String(tooltipLeft)}%` }}
            >
              <p className="text-ink-muted">{dayLabel(activeDay.day)}</p>
              <p className="mt-1 flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-3 bg-accent" />
                <strong className="tabular font-semibold text-ink">
                  {activeDay.sent}
                </strong>
                <span className="text-ink-muted">envoyés</span>
              </p>
              {activeDay.failed > 0 && (
                <p className="mt-0.5 flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3 bg-danger" />
                  <strong className="tabular font-semibold text-ink">
                    {activeDay.failed}
                  </strong>
                  <span className="text-ink-muted">en erreur</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The table view: every value reachable without hovering. */}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">
          Voir les chiffres
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Jour</th>
                <th className="px-3 py-1.5 text-right font-medium">Envoyés</th>
                <th className="px-3 py-1.5 text-right font-medium">En erreur</th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => (
                <tr key={day.day} className="border-t border-border">
                  <td className="px-3 py-1.5">{dayLabel(day.day)}</td>
                  <td className="px-3 py-1.5 text-right">{day.sent}</td>
                  <td className="px-3 py-1.5 text-right">{day.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
