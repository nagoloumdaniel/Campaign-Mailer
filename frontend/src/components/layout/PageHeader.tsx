import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'

/**
 * The top of a page: where you are, what it is, and the one thing to do here.
 *
 * The primary action sits on the same line as the title at every width above
 * a phone, and wraps under it below — never shrinks. A button whose label is
 * cut in half is worse than one on its own line.
 */
export function PageHeader({
  title,
  description,
  action,
  back,
  badges,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  back?: { to: string; label: string }
  badges?: ReactNode
}) {
  return (
    <div className="mb-6 sm:mb-8">
      {back && (
        <Link
          to={back.to}
          className="-ms-1.5 mb-3 inline-flex press items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="chevron-left" size={15} />
          {back.label}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">
              {title}
            </h1>
            {badges}
          </div>

          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>

        {/* Right-aligned, also when a phone pushes them under the title. */}
        {action && (
          <div className="ms-auto flex shrink-0 flex-wrap justify-end gap-2">
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

/** A heading between the sections of one page. */
export function SectionHeader({
  title,
  description,
  action,
  id,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  id?: string
  className?: string
}) {
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
