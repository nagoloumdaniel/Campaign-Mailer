import { IconButton } from './Button'

/**
 * Where you are in a list, and the two ways out of it.
 *
 * The range is the point — "4–6 sur 128" tells a reader how much is left,
 * which a pair of arrows on their own never does. It is rendered even on a
 * single page when `always` is set, so a section does not change height the
 * moment a filter drops it to one page.
 */
export function Pagination({
  offset,
  limit,
  total,
  onChange,
  label = 'Pagination',
  className = '',
}: {
  offset: number
  limit: number
  total: number
  onChange: (offset: number) => void
  label?: string
  className?: string
}) {
  if (total <= limit) {
    return null
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <nav
      aria-label={label}
      className={`flex items-center justify-between gap-3 ${className}`}
    >
      <p className="tabular text-xs text-ink-muted">
        {from}–{to} sur {total}
      </p>

      <div className="flex items-center gap-1">
        <IconButton
          icon="chevron-left"
          label="Page précédente"
          size="sm"
          variant="secondary"
          disabled={offset === 0}
          onClick={() => {
            onChange(Math.max(0, offset - limit))
          }}
        />
        <span className="tabular px-1.5 text-xs text-ink-muted" aria-live="polite">
          {page} / {pages}
        </span>
        <IconButton
          icon="chevron-right"
          label="Page suivante"
          size="sm"
          variant="secondary"
          disabled={to >= total}
          onClick={() => {
            onChange(offset + limit)
          }}
        />
      </div>
    </nav>
  )
}
