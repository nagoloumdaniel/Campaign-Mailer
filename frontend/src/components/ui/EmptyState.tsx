import type { ReactNode } from 'react'

import { Icon, type IconName } from './Icon'

/**
 * Nothing here, and what to do about it.
 *
 * Three rules. It names what is missing rather than reporting a count of
 * zero. It offers the next step as a real control, because "no campaigns yet"
 * with nothing to click is a dead end. And it tells an empty list apart from
 * a filter that matched nothing — those call for opposite actions, and a page
 * that says "create your first campaign" to someone who just mistyped a
 * search is telling them the wrong thing.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  compact = false,
  className = '',
}: {
  icon?: IconName
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-card border border-dashed border-border px-6 text-center ${
        compact ? 'py-8' : 'py-14'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-ink-subtle"
      >
        <Icon name={icon} size={20} />
      </span>

      <p className="mt-3.5 text-sm font-semibold text-ink">{title}</p>

      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
          {description}
        </p>
      )}

      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * Something failed, said without the reason it failed for.
 *
 * The technical message stays in the console and in Sentry. What reaches the
 * page is what the reader can act on: try again, or check the connection.
 */
export function ErrorState({
  title = 'Ces informations n’ont pas pu être chargées',
  description = 'Vérifiez votre connexion, puis réessayez.',
  onRetry,
  compact = false,
}: {
  title?: string
  description?: ReactNode
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center rounded-card border border-danger/30 bg-danger-soft/40 px-6 text-center ${
        compact ? 'py-6' : 'py-10'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger"
      >
        <Icon name="alert" size={19} />
      </span>

      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
        {description}
      </p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-9 press items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
        >
          <Icon name="refresh" size={15} />
          Réessayer
        </button>
      )}
    </div>
  )
}
