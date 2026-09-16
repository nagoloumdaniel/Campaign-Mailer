import { useId } from 'react'

/**
 * A ring, for a whole divided into a handful of parts.
 *
 * A donut is the wrong chart for comparing values — the eye reads angles
 * badly — and the right one for showing that a set adds up to something, which
 * is exactly what a campaign's outcomes do: every contact is sent, failed,
 * waiting or set aside, and nothing else.
 *
 * Drawn with `stroke-dasharray` on one circle per slice rather than with
 * arc paths: no trigonometry to get wrong, no seams between slices, and the
 * whole thing animates by transitioning one number.
 *
 * The legend is part of the chart, not an afterthought beside it, and it
 * carries the values: a colour with no number is a decoration.
 */

export interface DonutSlice {
  label: string
  value: number
  /** A CSS colour, taken from the theme tokens by the caller. */
  color: string
}

export function Donut({
  slices,
  total,
  centreValue,
  centreLabel,
  size = 148,
  thickness = 16,
}: {
  slices: readonly DonutSlice[]
  total: number
  centreValue: string
  centreLabel: string
  size?: number
  thickness?: number
}) {
  const titleId = useId()
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const shown = slices.filter((slice) => slice.value > 0)

  /**
   * Where each slice starts, as a running total of the ones before it.
   *
   * Built up front rather than accumulated inside the map: a variable mutated
   * while rendering is read again on the next render, and a chart whose first
   * slice starts a quarter of the way round is the kind of bug that only
   * appears after a re-render.
   */
  const starts = shown.map((_slice, index) =>
    shown.slice(0, index).reduce((sum, earlier) => sum + earlier.value, 0),
  )

  return (
    <figure className="m-0 flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${String(size)} ${String(size)}`}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {`${centreLabel} : ${centreValue}. ` +
              shown.map((slice) => `${slice.label} ${String(slice.value)}`).join(', ')}
          </title>

          {/* The track, so an empty campaign still draws a ring rather than
              nothing at all. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth={thickness}
          />

          {shown.map((slice, index) => {
            const length = total > 0 ? (slice.value / total) * circumference : 0
            const dash = `${String(length)} ${String(circumference - length)}`
            const start = starts.at(index) ?? 0
            const rotation = total > 0 ? (start / total) * 360 - 90 : -90

            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeLinecap="butt"
                transform={`rotate(${String(rotation)} ${String(size / 2)} ${String(size / 2)})`}
                className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
              />
            )
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular font-display text-2xl leading-none font-semibold tracking-tight">
            {centreValue}
          </span>
          <span className="mt-1 text-[11px] text-ink-muted">{centreLabel}</span>
        </div>
      </div>

      <figcaption className="min-w-0 flex-1">
        <ul className="space-y-1.5">
          {slices.map((slice) => (
            <li
              key={slice.label}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: slice.color }}
                />
                <span className="truncate text-ink-muted">{slice.label}</span>
              </span>
              <span className="tabular shrink-0 font-medium">{slice.value}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
