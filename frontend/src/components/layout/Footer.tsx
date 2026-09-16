import { Link } from 'react-router-dom'

import { Logo } from './Logo'

/**
 * The foot of every page.
 *
 * Three legal documents and a copyright line, which is what French law asks a
 * published service to carry within one click, and nothing else. A footer
 * with four columns of links on an application of six screens is furniture.
 *
 * The year is read from the clock rather than written down: a copyright that
 * says 2026 in 2027 is the smallest possible sign that nobody is home.
 */

const LEGAL = [
  { to: '/legal/mentions', label: 'Mentions légales' },
  { to: '/legal/cgu', label: 'Conditions d’utilisation' },
  { to: '/legal/confidentialite', label: 'Confidentialité (RGPD)' },
] as const

export function Footer({ className = '' }: { className?: string }) {
  return (
    <footer className={`border-t border-border ${className}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-center gap-2.5">
          <Logo size={22} className="text-ink-muted" />
          <p className="text-[13px] text-ink-muted">
            <span className="font-display font-semibold text-ink">Campaign Mailer</span>
            <span className="mx-1.5 text-ink-subtle">·</span>© {new Date().getFullYear()}.
            Tous droits réservés.
          </p>
        </div>

        <nav aria-label="Informations légales">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {LEGAL.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="text-[13px] text-ink-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
