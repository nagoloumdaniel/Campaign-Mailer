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
      className="bg-surface-raised inline-flex w-full press items-center justify-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm font-medium shadow-xs transition-colors hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-60"
    >
      <MailfindMark />
      {leaving ? 'Redirection vers MailFind…' : 'Continuer avec MailFind'}
    </a>
  )
}

function MailfindMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 512 512" className="size-[18px]">
      <rect width="512" height="512" rx="116" fill="#111C30" />
      <g fill="none" strokeWidth={64} strokeLinecap="round" strokeLinejoin="round">
        <path d="M144 144 L256 272 L368 144" stroke="#35C68D" />
        <path d="M144 368 V144" stroke="#FFFFFF" />
        <path d="M368 368 V144" stroke="#FFFFFF" />
      </g>
    </svg>
  )
}
