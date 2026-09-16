import type { CSSProperties, ReactNode } from 'react'

/**
 * The one surface every panel in the application is built on.
 *
 * A border and a whisper of shadow, never a heavy one: depth here separates a
 * panel from the page, it does not lift it off the screen. `interactive` adds
 * the only hover a card gets — a border that firms up — because a card that
 * slides or grows under the pointer makes a list feel unstable.
 */
export interface CardProps {
  children: ReactNode
  className?: string
  interactive?: boolean
  as?: 'div' | 'section' | 'article' | 'li'
  /** Only for the `--index` a staggered list sets; never for a colour. */
  style?: CSSProperties
  'aria-labelledby'?: string
}

export function Card({
  children,
  className = '',
  interactive = false,
  as: Tag = 'div',
  ...rest
}: CardProps) {
  return (
    <Tag
      className={`rounded-card border border-border bg-surface shadow-soft ${
        interactive
          ? 'transition-[border-color,box-shadow] duration-200 ease-out hover:border-border-strong hover:shadow-card'
          : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * A card's title row.
 *
 * The heading level is a prop because the same panel appears under an h1 on
 * one page and under an h2 on another, and a document whose headings skip a
 * level is unreadable with a screen reader's outline.
 */
export function CardHeader({
  title,
  id,
  description,
  action,
  level = 2,
  className = '',
}: {
  title: ReactNode
  id?: string
  description?: ReactNode
  action?: ReactNode
  level?: 2 | 3
  className?: string
}) {
  const Heading = level === 2 ? 'h2' : 'h3'

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <div className="min-w-0">
        <Heading id={id} className="text-[15px] font-semibold tracking-tight">
          {title}
        </Heading>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
