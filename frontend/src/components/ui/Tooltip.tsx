import { useId, useState, type ReactElement, type ReactNode } from 'react'

/**
 * A label for a control that shows only a picture.
 *
 * Shown on hover and on keyboard focus, not on hover alone: a control whose
 * meaning only appears to a mouse is unusable from a keyboard. The accessible
 * name still lives on the control itself, so this is a courtesy to sighted
 * users rather than the only place the name exists — which is why the bubble
 * is hidden from assistive technology and would otherwise be read twice.
 */
export function Tooltip({
  label,
  children,
  side = 'bottom',
  align = 'center',
}: {
  label: string
  children: ReactElement
  side?: 'bottom' | 'top'
  /**
   * `end` for a control against the right edge of the screen. Even invisible,
   * a centred bubble there overhangs the viewport and gives the whole page a
   * horizontal scrollbar.
   */
  align?: 'center' | 'end'
}): ReactNode {
  const id = useId()
  const [shown, setShown] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => {
        setShown(true)
      }}
      onPointerLeave={() => {
        setShown(false)
      }}
      onFocusCapture={() => {
        setShown(true)
      }}
      onBlurCapture={() => {
        setShown(false)
      }}
    >
      {children}

      <span
        id={id}
        aria-hidden="true"
        className={`pointer-events-none absolute z-50 ${
          align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'
        } rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium whitespace-nowrap text-ink shadow-pop transition-[opacity,transform] duration-150 ease-out ${
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
        } ${shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[-2px] opacity-0'}`}
      >
        {label}
      </span>
    </span>
  )
}
