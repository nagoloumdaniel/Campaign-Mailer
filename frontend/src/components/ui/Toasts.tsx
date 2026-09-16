import { Toaster } from 'sonner'

import { useTheme } from '@/theme/useTheme'

/**
 * Feedback that does not take the page hostage.
 *
 * An import reporting "412 importés, 3 rejetés" belongs beside the work, not
 * behind an OK button that has to be dismissed before the report can be read.
 * What *does* take the page is a confirmation: anything the user must answer
 * before it happens is a dialog, and anything reporting what already happened
 * is a toast. Nothing in the application uses a toast to ask a question.
 *
 * The toasts are dressed from the design tokens rather than from Sonner's own
 * palette, so they follow the theme with the rest of the interface instead of
 * staying light against a dark page.
 */
export function Toasts() {
  const { resolved } = useTheme()

  return (
    <Toaster
      position="bottom-right"
      closeButton
      theme={resolved}
      // Long enough to read a two-line report, short enough not to sit over
      // the work.
      duration={5000}
      gap={10}
      offset={16}
      toastOptions={{
        style: {
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-ink)',
          borderRadius: '0.875rem',
          boxShadow: 'var(--shadow-pop)',
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
        },
        classNames: {
          description: 'text-ink-muted',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-danger',
          warning: '[&_[data-icon]]:text-warning',
          info: '[&_[data-icon]]:text-info',
        },
      }}
    />
  )
}
