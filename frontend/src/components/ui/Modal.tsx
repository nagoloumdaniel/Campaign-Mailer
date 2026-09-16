import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Button } from './Button'
import { Icon, type IconName } from './Icon'

/**
 * The dialog, on top of the native `<dialog>` element.
 *
 * `showModal()` gives three things no hand-rolled overlay gets right for free:
 * the focus is trapped inside, everything behind it is inert, and Escape
 * closes it. The animation lives in the stylesheet, on `.dialog`, so the
 * closing frame plays — a React component that unmounts on close never has
 * one.
 *
 * A confirmation is asked once, in the words of what will happen, with the
 * cancel button first in the reading order and the acting one under the
 * thumb. Nothing here closes on a click on the backdrop when the action is
 * destructive: a mis-aimed click should not dismiss a question.
 */

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  icon?: IconName
  tone?: 'neutral' | 'danger' | 'success' | 'warning'
  /** Wider, for a dialog carrying a table or a list. */
  size?: 'sm' | 'md'
  /** Off for a destructive question, so a stray click cannot dismiss it. */
  dismissOnBackdrop?: boolean
}

const TONE_RING: Record<NonNullable<ModalProps['tone']>, string> = {
  neutral: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  icon,
  tone = 'neutral',
  size = 'sm',
  dismissOnBackdrop = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current

    if (!dialog) {
      return
    }

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires `cancel`, which would close the element without telling
      // React. Both are forwarded so the state stays the truth.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      onClick={(event) => {
        // The backdrop is the dialog element itself; a click on its own box is
        // a click outside the panel drawn inside it.
        if (dismissOnBackdrop && event.target === ref.current) {
          onClose()
        }
      }}
      className={`dialog m-auto w-[calc(100vw-2rem)] rounded-panel border border-border bg-surface p-0 text-ink shadow-pop backdrop:cursor-default ${
        size === 'md' ? 'max-w-xl' : 'max-w-md'
      }`}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          {icon && (
            <span
              aria-hidden="true"
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE_RING[tone]}`}
            >
              <Icon name={icon} size={19} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <div className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {description}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mt-1 -mr-1 flex size-8 shrink-0 press items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {children && <div className="mt-4">{children}</div>}

        {footer && (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neutral' | 'danger'
  icon?: IconName
  busy?: boolean
  size?: 'sm' | 'md'
}

/** A question with two answers, where one of them does something. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Annuler',
  tone = 'neutral',
  icon,
  busy = false,
  size = 'sm',
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      {...(description ? { description } : {})}
      tone={tone}
      {...(icon ? { icon } : {})}
      size={size}
      // A destructive question is never dismissed by a stray click.
      dismissOnBackdrop={tone !== 'danger'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
