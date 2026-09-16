/**
 * A bar that fills.
 *
 * `scaleX` rather than `width`: the same picture, without re-laying the bar
 * out on every frame of the transition. The fill has no radius of its own —
 * the track clips it — so the rounded ends do not squash as it scales.
 *
 * The `tone` is passed in rather than derived here, because what counts as
 * "nearly full" differs between a file upload and a daily allowance, and the
 * component should not be the place that decides.
 */
export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger' | 'info'

const FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

const TRACK: Record<ProgressTone, string> = {
  accent: 'bg-accent/15',
  success: 'bg-success/15',
  warning: 'bg-warning/20',
  danger: 'bg-danger/15',
  info: 'bg-info/15',
}

export function Progress({
  value,
  max = 100,
  tone = 'accent',
  label,
  size = 'md',
  className = '',
}: {
  value: number
  max?: number
  tone?: ProgressTone
  /** Read out instead of the bare numbers. Required: a nameless meter says nothing. */
  label: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const height = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2'

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={`overflow-hidden rounded-full ${height} ${TRACK[tone]} ${className}`}
    >
      <div
        className={`h-full w-full origin-left transition-transform duration-500 ease-out motion-reduce:transition-none ${FILL[tone]}`}
        style={{ transform: `scaleX(${String(share)})` }}
      />
    </div>
  )
}

/**
 * A bar made of several stacked parts, for a total split between outcomes.
 *
 * One bar rather than three: the question a campaign's progress answers is
 * how the whole divides, and three separate bars make that a subtraction.
 */
export function StackedProgress({
  segments,
  total,
  label,
  className = '',
}: {
  segments: readonly { value: number; tone: ProgressTone; label: string }[]
  total: number
  label: string
  className?: string
}) {
  const done = segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={segments
        .filter((segment) => segment.value > 0)
        .map((segment) => `${String(segment.value)} ${segment.label}`)
        .join(', ')}
      className={`flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <span
            key={segment.label}
            className={`${FILL[segment.tone]} transition-[flex-grow] duration-500 ease-out first:rounded-l-full last:rounded-r-full motion-reduce:transition-none`}
            style={{ flexGrow: segment.value }}
          />
        ) : null,
      )}
      {/* The remainder, so a half-done bar reads as half rather than as full. */}
      {total - done > 0 && <span style={{ flexGrow: total - done }} />}
    </div>
  )
}
