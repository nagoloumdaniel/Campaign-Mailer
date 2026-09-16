import { useId, type InputHTMLAttributes, type Ref, type ReactNode } from 'react'

import { Icon } from './Icon'

/**
 * The form controls, so every input in the application is the same height,
 * the same radius and the same focus ring.
 *
 * `hint` and `error` share one slot under the field, and the error wins: two
 * lines of advice under a control is one more than anyone reads, and the one
 * that matters when something is wrong is the one that says what is wrong.
 */

const CONTROL =
  'w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-ink transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-subtle hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted'

export function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {children}
      </label>
      {hint && <span className="text-xs text-ink-subtle">{hint}</span>}
    </div>
  )
}

export function FieldNote({
  children,
  error = false,
}: {
  children: ReactNode
  error?: boolean
}) {
  return (
    <p
      className={`mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed ${
        error ? 'text-danger' : 'text-ink-muted'
      }`}
      {...(error ? { role: 'alert' as const } : {})}
    >
      {error && <Icon name="alert" size={13} className="mt-px" />}
      <span>{children}</span>
    </p>
  )
}

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className'
> {
  label: string
  hint?: ReactNode
  note?: ReactNode
  error?: string | null
  /** Hides the label visually while leaving it for assistive technology. */
  labelHidden?: boolean
  className?: string
  /** React 19 passes a ref to a function component like any other prop. */
  ref?: Ref<HTMLInputElement>
}

export function TextField({
  label,
  hint,
  note,
  error,
  labelHidden = false,
  className = '',
  id,
  ref,
  ...rest
}: TextFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const noteId = `${fieldId}-note`

  return (
    <div className={className}>
      {labelHidden ? (
        <label htmlFor={fieldId} className="sr-only">
          {label}
        </label>
      ) : (
        <Label htmlFor={fieldId} hint={hint}>
          {label}
        </Label>
      )}

      <input
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || note ? noteId : undefined}
        className={`${CONTROL} h-10 ${labelHidden ? '' : 'mt-1.5'} ${
          error ? 'border-danger focus:border-danger focus:ring-danger/15' : ''
        }`}
        {...rest}
      />

      {(error ?? note) && (
        <div id={noteId}>
          <FieldNote error={Boolean(error)}>{error ?? note}</FieldNote>
        </div>
      )}
    </div>
  )
}
