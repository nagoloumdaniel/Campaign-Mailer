import type { ReactNode } from 'react'

import { Icon, type IconName } from './Icon'

/**
 * A short, coloured label.
 *
 * Colour is a second channel here and never the first: every badge carries a
 * word, and the ones that report a state carry a shape too. A reader who
 * cannot tell the amber from the green reads the same information from the
 * text, at full speed.
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-2 text-ink-muted',
  accent: 'border-accent/25 bg-accent-soft text-accent',
  success: 'border-success/25 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  info: 'border-info/25 bg-info-soft text-info',
}

export function Badge({
  children,
  tone = 'neutral',
  icon,
  dot = false,
  className = '',
}: {
  children: ReactNode
  tone?: BadgeTone
  icon?: IconName
  /** A filled dot before the label, for a state that is live right now. */
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}
