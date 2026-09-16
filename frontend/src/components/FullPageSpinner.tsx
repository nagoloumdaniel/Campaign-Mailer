import { Logo } from './layout/Logo'

/**
 * Shown while the application does not yet know whether anyone is signed in.
 *
 * The one place a spinner is the right answer: there is no page shape to
 * stand in for yet, because which page comes next depends on the answer. Every
 * other wait in the application gets a skeleton instead.
 *
 * The label is read out to assistive technology and hidden visually: a bare
 * spinner says "wait" to a sighted user and nothing at all to a screen reader.
 */
export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
    >
      <span className="sr-only">{label}</span>

      <Logo
        size={34}
        className="animate-pulse text-ink-subtle motion-reduce:animate-none"
      />

      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
      />
    </div>
  )
}
