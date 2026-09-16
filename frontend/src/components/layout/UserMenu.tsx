import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Icon } from '@/components/ui/Icon'

/**
 * The account, behind the one thing on the page that is unmistakably yours.
 *
 * Gmail does not hand back a profile picture without a second OAuth scope, and
 * a scope is an architectural decision here rather than a detail — Google's
 * review of this application is already heavier for `gmail.send`. So the
 * avatar is drawn from the address instead: the same letter, the same hue,
 * every time, which is all an avatar in a header actually has to do.
 *
 * The address itself is in the menu, not in the bar. It is the only way to
 * tell which Google account is connected, and campaigns are sent from it — so
 * it has to be reachable, but it is too long to live in a navigation bar at
 * every width.
 */

/** A stable hue from the address, so the same account always looks the same. */
function hueOf(email: string): number {
  let hash = 0

  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) % 360
  }

  return hash
}

export function Avatar({ email, size = 32 }: { email: string; size?: number }) {
  const hue = hueOf(email)

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        // oklch, so the two accounts that land near each other in hue still
        // read as different: the lightness is fixed, which it is not in hsl.
        background: `oklch(88% 0.07 ${String(hue)})`,
        color: `oklch(35% 0.12 ${String(hue)})`,
        fontSize: size * 0.42,
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
    >
      {email.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const email = user?.email ?? ''

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Compte : ${email}`}
        className="flex press items-center gap-2 rounded-full border border-transparent p-0.5 hover:border-border hover:bg-surface-2"
      >
        <Avatar email={email} size={30} />
        {/* The address only from a laptop up. Below that the avatar is the
            control, and the address is a line inside the menu. */}
        <span className="hidden max-w-36 truncate pr-1 text-[13px] text-ink-muted lg:block">
          {email}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Compte"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right animate-[enter-up_160ms_var(--ease-out)] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2.5">
            <Avatar email={email} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">Mon compte</p>
              <p className="truncate text-xs text-ink-muted" title={email}>
                {email}
              </p>
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <Link
            to="/account"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-surface-2"
          >
            <Icon name="settings" size={16} className="text-ink-muted" />
            Mon compte
          </Link>

          <button
            type="button"
            role="menuitem"
            disabled={leaving}
            onClick={() => {
              setLeaving(true)
              void signOut().finally(() => {
                // Replace, not push: the signed-in page must not come back
                // with the browser's back button, even though it would be
                // empty.
                void navigate('/login', { replace: true })
              })
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            <Icon name="logout" size={16} className="text-ink-muted" />
            {leaving ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
        </div>
      )}
    </div>
  )
}
