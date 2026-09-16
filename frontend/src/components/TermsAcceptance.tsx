import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Icon, type IconName } from '@/components/ui/Icon'
import { accountApi } from '@/services/account'
import { ApiError } from '@/services/api'
import { TERMS_VERSION } from '@/services/legal'

/**
 * Shown before anything else until the current terms are accepted.
 *
 * Three sentences a person can actually read, and the full texts one click
 * away, rather than a wall of legal text with a button under it. The one
 * cookie is mentioned here because it is the only one: there is no tracking,
 * so there is no consent banner to show.
 */
export function TermsAcceptance() {
  const { user, refresh, signOut } = useAuth()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Someone who accepted an earlier version is told the terms changed, not
  // greeted as a newcomer.
  const renewal = user?.termsVersion != null

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (!accepted || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await accountApi.acceptTerms(TERMS_VERSION)
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Les conditions ont été mises à jour entre-temps. Rechargez la page pour lire la nouvelle version.'
          : 'L’acceptation n’a pas pu être enregistrée. Réessayez.',
      )
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-12">
      <Logo size={30} className="text-ink" />

      <h1 className="mt-5 text-[26px] font-semibold tracking-tight text-balance">
        {renewal ? 'Nos conditions ont changé' : 'Avant de commencer'}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        {renewal
          ? 'Merci de relire et d’accepter la nouvelle version pour continuer.'
          : 'Trois points à connaître, puis vous pourrez créer votre première campagne.'}
      </p>

      <ul className="mt-7 space-y-3">
        <Point icon="send">
          Les e-mails partent de <strong className="font-medium text-ink">votre</strong>{' '}
          compte Gmail. Vous êtes responsable de leur contenu et du choix de leurs
          destinataires.
        </Point>
        <Point icon="users">
          Vos données et celles de vos contacts servent uniquement à envoyer vos
          campagnes. Vous pouvez les télécharger ou les supprimer à tout moment.
        </Point>
        <Point icon="check-circle">
          Un seul cookie, indispensable pour rester connecté. Aucun traceur, aucune
          publicité — et donc aucune bannière de consentement.
        </Point>
      </ul>

      <Card as="section" className="mt-7 p-5">
        <form onSubmit={(event) => void submit(event)}>
          <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => {
                setAccepted(event.target.checked)
              }}
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <span>
              J’ai lu et j’accepte les{' '}
              <Link
                to="/legal/cgu"
                target="_blank"
                className="text-accent underline underline-offset-2"
              >
                conditions générales d’utilisation
              </Link>{' '}
              et la{' '}
              <Link
                to="/legal/confidentialite"
                target="_blank"
                className="text-accent underline underline-offset-2"
              >
                politique de confidentialité
              </Link>
              .
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="mt-4 flex enter items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger"
            >
              <Icon name="alert" size={15} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              icon="check"
              loading={busy}
              disabled={!accepted}
            >
              Accepter et continuer
            </Button>
            <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
              Se déconnecter
            </Button>
          </div>
        </form>
      </Card>

      {/* The rights over one's data never wait on accepting anything. */}
      <p className="mt-6 text-xs text-ink-muted">
        Vous préférez partir ?{' '}
        <Link to="/account" className="underline underline-offset-2 hover:text-ink">
          Téléchargez ou supprimez vos données
        </Link>{' '}
        sans accepter.
      </p>
    </main>
  )
}

function Point({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-relaxed text-ink-muted">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"
      >
        <Icon name={icon} size={14} />
      </span>
      <span>{children}</span>
    </li>
  )
}
