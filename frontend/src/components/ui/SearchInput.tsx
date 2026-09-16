import { useEffect, useId, useState } from 'react'

import { Icon } from './Icon'

/**
 * A search box that waits for the typist to stop.
 *
 * The value is held here and reported after a pause, so a query that costs a
 * request is not sent on every keystroke, while the field itself never lags
 * behind the keyboard. Clearing reports at once: waiting 250 ms to show a
 * list the user just asked to see again reads as a stall.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher…',
  label = 'Rechercher',
  delayMs = 250,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  delayMs?: number
  className?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)

  // Follows the outside when a filter reset clears it, without fighting the
  // typist. Adjusted during render rather than in an effect: React re-runs
  // this component before painting, so the field never shows the stale value
  // for a frame, and no second render is queued.
  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }

  useEffect(() => {
    if (draft === value) {
      return
    }

    const timer = window.setTimeout(() => {
      onChange(draft)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [draft, value, delayMs, onChange])

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>

      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
      />

      <input
        id={id}
        type="search"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        className="h-10 w-full rounded-xl border border-border bg-surface pr-9 pl-9 text-sm text-ink transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-subtle hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />

      {draft !== '' && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 press items-center justify-center rounded-md text-ink-subtle hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}
