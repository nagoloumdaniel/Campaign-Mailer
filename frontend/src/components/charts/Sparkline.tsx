import { useId } from 'react'

/**
 * A line with no axes, read as a shape rather than as values.
 *
 * It belongs beside a number, not instead of one: the figure says how much,
 * the line says which way. Anything that needs a value read off it wants the
 * column chart instead.
 *
 * Drawn as a path plus a filled area under it, both from the same points, so
 * the line stays legible on a dark theme where a bare hairline disappears.
 */
export function Sparkline({
  values,
  label,
  width = 120,
  height = 34,
  className = '',
}: {
  values: readonly number[]
  /** Read out in place of the shape, which says nothing to a screen reader. */
  label: string
  width?: number
  height?: number
  className?: string
}) {
  const id = useId()

  if (values.length < 2) {
    return null
  }

  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)

  const points = values.map((value, index) => ({
    x: index * step,
    // Two pixels of padding top and bottom, so a peak is not clipped by the
    // viewBox and a flat zero line is still visible.
    y: height - 2 - (value / max) * (height - 4),
  }))

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(' ')

  const area = `${line} L${String(width)} ${String(height)} L0 ${String(height)} Z`

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      role="img"
      aria-labelledby={id}
      preserveAspectRatio="none"
      className={className}
    >
      <title id={id}>{label}</title>

      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${id}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
