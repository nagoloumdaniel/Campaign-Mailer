import { useState } from 'react'

/**
 * Signs in through MailFind (MailFind decision D-26).
 *
 * An anchor for the same reason as the Google button: the flow is a chain of
 * redirects, and the server has to put its state in the session before the
 * browser leaves for MailFind.
 */
export function MailfindSignInButton() {
  const [leaving, setLeaving] = useState(false)

  return (
    <a
      href="/api/auth/mailfind"
      onClick={() => {
        setLeaving(true)
      }}
      aria-disabled={leaving}
      className="bg-surface-raised inline-flex w-full items-center justify-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm font-medium shadow-xs transition-colors hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-60"
    >
      {leaving ? 'Redirection vers MailFind…' : 'Continuer avec MailFind'}
    </a>
  )
}
