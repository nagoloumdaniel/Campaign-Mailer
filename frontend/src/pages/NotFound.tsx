import { Link } from 'react-router-dom'

import { Footer } from '@/components/layout/Footer'
import { Logo } from '@/components/layout/Logo'
import { LinkButton } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

/**
 * A page that does not exist, said in the application's own voice.
 *
 * It keeps the shell — the mark at the top, the footer at the bottom — so a
 * wrong address does not feel like leaving the product. The graphic is the
 * number itself, set in the display face at a size nothing else uses, rather
 * than an illustration that would have to be drawn, themed and loaded.
 *
 * Two ways out, because the wrong address arrives two ways: a mistyped URL
 * wants the home page, a stale bookmark to a deleted campaign wants the list.
 */
export function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 pt-5">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-ink"
          aria-label="Campaign Mailer, accueil"
        >
          <Logo size={26} />
          <span className="font-display text-[15px] font-semibold tracking-tight">
            Campaign Mailer
          </span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        {/* The mark, blurred and oversized behind the number: a graphic that
            costs no asset and takes the theme for free. */}
        <div className="relative flex items-center justify-center">
          <Logo size={168} className="absolute text-ink opacity-[0.045] blur-[1px]" />
          <p className="relative font-display text-[84px] leading-none font-bold tracking-tighter">
            404
          </p>
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-tight">Page introuvable</h1>

        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
          Cette adresse ne correspond à aucune page. Elle a peut-être changé, ou la
          campagne que vous cherchiez a été supprimée.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <LinkButton to="/" variant="primary" icon="home">
            Retour à l’accueil
          </LinkButton>
          <LinkButton to="/campaigns" variant="secondary" icon="send">
            Voir mes campagnes
          </LinkButton>
        </div>

        <p className="mt-8 flex items-center gap-1.5 text-xs text-ink-subtle">
          <Icon name="info" size={13} />
          Erreur 404 — la page demandée n’existe pas
        </p>
      </main>

      <Footer />
    </div>
  )
}
