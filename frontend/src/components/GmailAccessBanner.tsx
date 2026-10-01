import { useAuth } from '@/auth/useAuth'

import { Icon } from './ui/Icon'

/**
 * Shown to an account created through MailFind until Google grants sending.
 *
 * MailFind vouches for the identity and nothing more: no Google token crosses
 * between the two applications. Everything works except starting a campaign,
 * so the one missing step is said up front rather than discovered when the
 * first send fails.
 */
export function GmailAccessBanner() {
  const { user } = useAuth()

  if (user?.gmailConnected !== false) {
    return null
  }

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-[13px]"
    >
      <Icon name="send" size={15} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 leading-relaxed text-ink-muted">
        Pour envoyer vos campagnes, autorisez Campaign Mailer à envoyer depuis votre
        compte Gmail. Il ne pourra toujours pas lire votre boîte.
      </p>
      <a
        href="/api/auth/google"
        className="font-medium text-accent underline underline-offset-2"
      >
        Autoriser l’envoi avec Gmail
      </a>
    </div>
  )
}
