import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Icon, type IconName } from '@/components/ui/Icon'

/**
 * One number, with what it counts.
 *
 * The number leads, in the display face and at a size nothing else on the
 * page uses, because a dashboard is read by scanning the figures first and
 * the labels only where a figure is surprising. The label sits above it in
 * small caps-height text, and anything else — a trend, a unit, a caveat —
 * goes underneath where it cannot compete.
 *
 * The icon is decorative and deliberately quiet. A row of seven saturated
 * tiles turns a dashboard into a toy; these are the colour of muted text
 * until the card means something, and only then take a tone.
 */

export type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<StatTone, string> = {
  neutral: 'bg-surface-2 text-ink-subtle',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

export interface StatCardProps {
  label: string
  value: string
  icon: IconName
  tone?: StatTone
  detail?: string | undefined
  /** A small chart beside the figure: which way, where the figure says how much. */
  trend?: ReactNode
  /** Turns the whole card into a link, for a figure that has a page behind it. */
  to?: string | undefined
  index?: number
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
  detail,
  trend,
  to,
  index = 0,
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}
        >
          <Icon name={icon} size={16} />
        </span>
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <p className="tabular font-display text-[26px] leading-none font-semibold tracking-tight">
          {value}
        </p>
        {trend}
      </div>

      {detail && <p className="mt-1.5 text-xs text-ink-muted">{detail}</p>}
    </>
  )

  const className =
    'stagger rounded-card border border-border bg-surface p-4 shadow-soft transition-[border-color,box-shadow] duration-200 ease-out'

  return to ? (
    <Link
      to={to}
      style={{ '--index': index } as CSSProperties}
      className={`${className} block hover:border-border-strong hover:shadow-card`}
    >
      {body}
    </Link>
  ) : (
    <div style={{ '--index': index } as CSSProperties} className={className}>
      {body}
    </div>
  )
}
