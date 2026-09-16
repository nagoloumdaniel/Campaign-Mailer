import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Icon, type IconName } from './Icon'

/**
 * The dropdown, built rather than styled.
 *
 * A native `<select>` cannot be themed: the list it opens is drawn by the
 * operating system, which means a white menu in front of a dark application
 * and a font that belongs to nothing else on the page. That is the one reason
 * to replace it, and replacing it means owing the keyboard everything the
 * native control gave for free — so all of it is here: Up and Down move the
 * highlight, Home and End jump, Enter and Space commit, Escape cancels and
 * puts the focus back on the button, Tab closes, and typing a letter jumps to
 * the option starting with it.
 *
 * The listbox is positioned, not portalled, so it stays with its field when
 * the page scrolls. Its containers must therefore not clip it; the panels it
 * sits in are laid out with that in mind.
 */

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** A second line, for a choice that needs explaining. */
  description?: string
  icon?: IconName
}

export interface SelectProps<T extends string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  label: string
  labelHidden?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Opens the list above the field, for a control near the bottom of a panel. */
  align?: 'start' | 'end'
  size?: 'sm' | 'md'
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  labelHidden = false,
  placeholder = 'Choisir…',
  disabled = false,
  className = '',
  align = 'start',
  size = 'md',
}: SelectProps<T>) {
  const buttonId = useId()
  const listId = `${buttonId}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  /** The letters typed in the last second, for jump-to-option. */
  const typed = useRef({ text: '', at: 0 })

  const selected = options.find((option) => option.value === value)

  const close = useCallback((focusButton: boolean) => {
    setOpen(false)
    if (focusButton) {
      buttonRef.current?.focus()
    }
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options.at(index)

      if (option) {
        onChange(option.value)
      }

      close(true)
    },
    [options, onChange, close],
  )

  /** A click anywhere else closes it, as a native menu does. */
  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  /** The highlighted option is scrolled into view, including when a key moved it. */
  useEffect(() => {
    if (!open) {
      return
    }

    listRef.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function openList() {
    const current = options.findIndex((option) => option.value === value)
    setActive(current === -1 ? 0 : current)
    setOpen(true)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) {
      return
    }

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => Math.min(index + 1, options.length - 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => Math.max(index - 1, 0))
        return
      case 'Home':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(active)
        return
      case 'Escape':
        event.preventDefault()
        close(true)
        return
      case 'Tab':
        // Not prevented: Tab should still move on, the list just gets out of
        // the way first.
        setOpen(false)
        return
      default:
        break
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now()
      typed.current = {
        text: now - typed.current.at > 900 ? event.key : typed.current.text + event.key,
        at: now,
      }

      const query = typed.current.text.toLowerCase()
      const found = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(query),
      )

      if (found !== -1) {
        setActive(found)
      }
    }
  }

  const height = size === 'sm' ? 'h-9 text-[13px]' : 'h-10 text-sm'

  return (
    <div className={className}>
      {labelHidden ? null : (
        <span id={`${buttonId}-label`} className="text-[13px] font-medium text-ink">
          {label}
        </span>
      )}

      <div ref={rootRef} className={`relative ${labelHidden ? '' : 'mt-1.5'}`}>
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (open) {
              setOpen(false)
            } else {
              openList()
            }
          }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={labelHidden ? label : undefined}
          aria-labelledby={labelHidden ? undefined : `${buttonId}-label ${buttonId}`}
          className={`flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 ${height} text-ink transition-[border-color,box-shadow] duration-150 ease-out hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted`}
        >
          {selected?.icon && <Icon name={selected.icon} size={15} />}
          <span
            className={`min-w-0 flex-1 truncate text-left ${selected ? '' : 'text-ink-subtle'}`}
          >
            {selected?.label ?? placeholder}
          </span>
          <Icon
            name="chevron-down"
            size={15}
            className={`text-ink-subtle transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${buttonId}-option-${String(active)}`}
            onKeyDown={onKeyDown}
            className={`absolute z-40 mt-1.5 max-h-64 w-full min-w-max overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop ${
              align === 'end' ? 'right-0' : 'left-0'
            } origin-top animate-[enter-up_140ms_var(--ease-out)]`}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value

              return (
                <li key={option.value}>
                  {/* The option is the row, not a button inside it: a listbox
                      whose options are buttons is announced twice. */}
                  <div
                    id={`${buttonId}-option-${String(index)}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      commit(index)
                    }}
                    onPointerEnter={() => {
                      setActive(index)
                    }}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                      index === active ? 'bg-surface-2' : ''
                    } ${isSelected ? 'text-accent' : 'text-ink'}`}
                  >
                    {option.icon && (
                      <Icon name={option.icon} size={15} className="mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description && (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {isSelected && <Icon name="check" size={15} className="mt-0.5" />}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
