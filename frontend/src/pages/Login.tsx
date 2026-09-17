import type { ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Footer } from '@/components/layout/Footer'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { ServerUnreachable } from '@/components/ServerUnreachable'
import { Icon, type IconName } from '@/components/ui/Icon'
import { GOOGLE_PERMISSIONS_URL, type DeletionReport } from '@/services/account'

/**
 * The only page a visitor sees before signing in.
 *
 * One action, and the three things a person needs to know before taking it:
 * what the product does, that it sends from their own Gmail, and that it
 * cannot read their inbox. That last one is said before the consent screen
 * rather than after — seeing Google ask for send access with no warning is
 * what makes people close the tab.
 */
export function Login() {
  const { status } = useAuth()
  const [params] = useSearchParams()
  const failed = params.get('error') === 'google'
  const deleted = (useLocation().state as { deleted?: DeletionReport } | null)?.deleted

  if (status === 'loading') {
    return <FullPageSpinner label="Vérification de la session" />
  }

  // Offering a sign-in button that redirects to an API which is not answering
  // would fail in a way that looks like a rejected account.
  if (status === 'unreachable') {
    return <ServerUnreachable />
  }

  // Someone already signed in has no business on this page, and landing here
  // after a refresh would look like being logged out.
  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }

  return (
    // The whole page fits one laptop screen: past md the pitch and the three
    // reassurances sit side by side instead of stacking, which is what pushed
    // the footer below the fold. min-h rather than h, so a very short window
    // scrolls instead of clipping the sign-in button.
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 pt-4">
        <span className="flex items-center gap-2">
          <Logo size={26} />
          <span className="font-display text-[15px] font-semibold tracking-tight">
            Campaign Mailer
          </span>
        </span>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid w-full max-w-md flex-1 content-center gap-8 px-5 py-6 md:max-w-4xl md:grid-cols-[1.15fr_1fr] md:items-center md:gap-12">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[32px]">
            Vos candidatures, envoyées une par une.
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            Un message, une liste de contacts, et des envois étalés sur plusieurs jours
            depuis votre propre compte Gmail — au rythme d’une personne, pas d’un robot.
          </p>

          {deleted && (
            <div
              role="status"
              className="mt-6 enter rounded-xl border border-border bg-surface px-3.5 py-3 text-[13px]"
            >
              <p className="flex items-center gap-2 font-medium">
                <Icon name="check-circle" size={15} className="text-success" />
                Votre compte et toutes ses données ont été supprimés.
              </p>
              {!deleted.googleRevoked && (
                // Said plainly, with the way to do it: the one step that could
                // not be completed is the one the user can finish in a minute.
                <p className="mt-2 leading-relaxed text-ink-muted">
                  Google n’a pas pu être prévenu. Retirez l’accès de Campaign Mailer
                  depuis{' '}
                  <a
                    href={GOOGLE_PERMISSIONS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    les autorisations de votre compte Google
                  </a>
                  .
                </p>
              )}
            </div>
          )}

          {failed && (
            <p
              role="alert"
              className="mt-6 flex enter items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] text-danger"
            >
              <Icon name="alert" size={15} className="mt-px shrink-0" />
              La connexion avec Google n’a pas abouti. Réessayez, ou vérifiez que vous
              avez bien autorisé l’accès.
            </p>
          )}

          <div className="mt-6">
            <GoogleSignInButton />
          </div>
        </div>

        <ul className="space-y-3 border-t border-border pt-6 md:rounded-2xl md:border md:bg-surface md:p-5">
          <Point icon="send">
            Les e-mails partent de <strong className="font-medium text-ink">votre</strong>{' '}
            adresse Gmail, avec vos réponses dans votre boîte.
          </Point>
          <Point icon="eye">
            L’application{' '}
            <strong className="font-medium text-ink">ne peut pas lire</strong> votre boîte
            de réception. Elle demande l’envoi, rien d’autre.
          </Point>
          <Point icon="gauge">
            Le rythme reste sous les limites de Gmail, pour ne pas faire repérer votre
            compte.
          </Point>
        </ul>
      </main>

      <Footer />
    </div>
  )
}

function Point({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-muted">
      <span
        aria-hidden="true"
        className="mt-px flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"
      >
        <Icon name={icon} size={13} />
      </span>
      <span>{children}</span>
    </li>
  )
}
