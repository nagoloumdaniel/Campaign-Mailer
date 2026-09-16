import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { TERMS_UPDATED } from '@/services/legal'

import { Footer } from './layout/Footer'
import { Logo } from './layout/Logo'
import { ThemeToggle } from './layout/ThemeToggle'

/**
 * The frame of the three legal pages.
 *
 * Public: someone deciding whether to sign in must be able to read them
 * first, which is why this is a layout of its own rather than a page inside
 * the application shell.
 *
 * Set narrower than the rest of the application, around 70 characters a line.
 * These are the only pages here that are read as prose rather than scanned,
 * and a legal text set across a dashboard's full width is one nobody finishes.
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <Link
            to="/"
            className="flex items-center gap-2 text-ink"
            aria-label="Campaign Mailer, accueil"
          >
            <Logo size={24} />
            <span className="font-display text-[15px] font-semibold tracking-tight">
              Campaign Mailer
            </span>
          </Link>

          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:py-14">
        <h1 className="text-[28px] font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          Dernière mise à jour : {TERMS_UPDATED}
        </p>

        <article className="prose-legal mt-8 space-y-8 text-[15px]">{children}</article>
      </main>

      <Footer />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

/** A configured value, or a visible gap: never an invented one. */
export function Field({ value }: { value: string | null }) {
  return value ? <>{value}</> : <em className="text-warning not-italic">à compléter</em>
}
