import { Icon, type IconName } from './Icon'

/**
 * A choice among a handful of options, all visible at once.
 *
 * A dropdown hides its options behind a click, which is right for a list of
 * time zones and wrong for three tabs: when every option fits on one line,
 * showing them all is both faster and more honest about what the interface
 * can do.
 *
 * Built as a radio group rather than as buttons, so the arrow keys move
 * between the options the way a keyboard user expects, without a line of
 * JavaScript.
 */
export interface Segment<T extends string> {
  value: T
  label: string
  icon?: IconName
  /** A tally beside the label, for a filter that knows how much it holds. */
  count?: number
}

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  label,
  size = 'md',
  className = '',
}: {
  value: T
  segments: readonly Segment<T>[]
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1 ${className}`}
    >
      {segments.map((segment) => {
        const selected = segment.value === value

        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              onChange(segment.value)
            }}
            className={`inline-flex shrink-0 press items-center gap-1.5 rounded-lg font-medium whitespace-nowrap ${
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'
            } ${
              selected
                ? 'bg-surface text-ink shadow-soft'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {segment.icon && <Icon name={segment.icon} size={14} />}
            {segment.label}
            {segment.count !== undefined && (
              <span
                className={`tabular rounded-full px-1.5 text-[11px] ${
                  selected ? 'bg-accent-soft text-accent' : 'bg-surface text-ink-subtle'
                }`}
              >
                {segment.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
