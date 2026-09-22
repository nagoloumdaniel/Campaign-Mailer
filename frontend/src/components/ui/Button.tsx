import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Icon, type IconName } from './Icon'

/**
 * Every action in the application, in four weights.
 *
 * A variant, not a set of booleans. `primary` is the one thing a screen is
 * for; `secondary` is everything else that acts; `ghost` is navigation and
 * dismissal; `danger` is the one that cannot be undone. A screen with two
 * primaries has no primary.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-soft hover:bg-accent-hover disabled:hover:bg-accent',
  secondary:
    'border border-border bg-surface text-ink shadow-soft hover:border-border-strong hover:bg-surface-2',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white shadow-soft hover:brightness-110',
}

const SIZES: Record<ButtonSize, string> = {
  // 44px tall on `md`: the touch target a thumb can actually hit, which is
  // also comfortable with a mouse.
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-[13px]',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-[15px]',
}

const BASE =
  'press inline-flex select-none items-center justify-center font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Puts the icon after the label, for anything that leads onwards. */
  iconAfter?: IconName
  /** Swaps the label for a waiting one and blocks a second click. */
  loading?: boolean
  block?: boolean
  /**
   * Below 640 px, the icon alone in a square button; the label stays for
   * screen readers and shows as a tooltip. For a row of actions that would
   * otherwise run off a phone's screen.
   */
  compact?: boolean | undefined
  className?: string
  children?: ReactNode
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

function classesOf({
  variant = 'secondary',
  size = 'md',
  block,
  compact,
  className = '',
}: CommonProps): string {
  return [
    BASE,
    VARIANTS[variant],
    SIZES[size],
    block ? 'w-full' : '',
    compact ? (size === 'sm' ? 'max-sm:w-8 max-sm:px-0' : 'max-sm:w-10 max-sm:px-0') : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

/** The label, hidden on a phone when the button is compact but still read out. */
function labelOf(children: ReactNode, compact: boolean | undefined): ReactNode {
  return compact ? <span className="max-sm:sr-only">{children}</span> : children
}

/** The tooltip a compact button shows on a phone, where its label is hidden. */
function titleOf(children: ReactNode, compact: boolean | undefined): string | undefined {
  return compact && typeof children === 'string' ? children : undefined
}

/** The spinner shown inside a button while its action runs. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-none"
    />
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  loading = false,
  block = false,
  compact,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 15 : 17

  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      // Announced, not just drawn: a screen reader otherwise reads the old
      // label while the action is still running.
      aria-busy={loading || undefined}
      title={titleOf(children, compact)}
      className={classesOf({
        variant,
        size,
        block,
        compact,
        ...(className ? { className } : {}),
      })}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={iconSize} />}
      {labelOf(children, compact)}
      {iconAfter && !loading && <Icon name={iconAfter} size={iconSize} />}
    </button>
  )
}

export type LinkButtonProps = CommonProps & {
  to: string
  state?: unknown
}

/** The same shape, for a control that navigates rather than acts. */
export function LinkButton({
  to,
  state,
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  block = false,
  className,
  children,
}: LinkButtonProps) {
  const iconSize = size === 'sm' ? 15 : 17

  return (
    <Link
      to={to}
      state={state}
      className={classesOf({ variant, size, block, ...(className ? { className } : {}) })}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={iconSize} />}
    </Link>
  )
}

export type AnchorButtonProps = CommonProps & {
  href: string
  download?: boolean
  target?: string
  rel?: string
}

/**
 * For a download or an outside address.
 *
 * A plain anchor rather than a fetch: the browser handles the download, the
 * session cookie rides along, and nothing is held in memory on this side.
 */
export function AnchorButton({
  href,
  download,
  target,
  rel,
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  block = false,
  compact,
  className,
  children,
}: AnchorButtonProps) {
  const iconSize = size === 'sm' ? 15 : 17

  return (
    <a
      href={href}
      download={download}
      target={target}
      rel={rel}
      title={titleOf(children, compact)}
      className={classesOf({
        variant,
        size,
        block,
        compact,
        ...(className ? { className } : {}),
      })}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {labelOf(children, compact)}
      {iconAfter && <Icon name={iconAfter} size={iconSize} />}
    </a>
  )
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className'
> {
  icon: IconName
  /** Required. An icon on its own names nothing to a screen reader. */
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

/**
 * An action with no visible label.
 *
 * The label is mandatory in the type, and it lands on both `aria-label` and
 * `title`: the first for assistive technology, the second as the tooltip a
 * pointer user gets when the picture is not obvious.
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className = '',
  ...rest
}: IconButtonProps) {
  const box = size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl'

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${BASE} ${VARIANTS[variant]} ${box} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  )
}
