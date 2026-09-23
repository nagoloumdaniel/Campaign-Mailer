import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

import { Icon, type IconName } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'

import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import { UserMenu } from './UserMenu'

/**
 * The floating navigation.
 *
 * A translucent glass navigation with backdrop blur, allowing the content
 * behind it to remain visible while appearing softly diffused.
 *
 * The border and shadow become more pronounced once the page scrolls.
 */

const NAV: {
  to: string
  label: string
  icon: IconName
  end?: boolean
}[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/campaigns', label: 'Campagnes', icon: 'send' },
  { to: '/contacts', label: 'Contacts', icon: 'users' },
  { to: '/history', label: 'Historique', icon: 'history' },
]

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
    }

    onScroll()

    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={`relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-1.5 rounded-2xl px-2 transition-[background-color,box-shadow,border-color,backdrop-filter] duration-300 ease-out sm:gap-3 sm:px-3.5 ${
          scrolled
            ? 'bg-background/65 border border-border/60 shadow-card backdrop-blur-2xl'
            : 'bg-background/45 border border-white/20 shadow-none backdrop-blur-xl dark:border-white/10'
        }`}
      >
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-lg pr-1 pl-1 text-ink"
          aria-label="Campaign Mailer, accueil"
        >
          <Logo size={26} />

          <span className="hidden truncate font-display text-[15px] font-semibold tracking-tight lg:block">
            Campaign&nbsp;Mailer
          </span>
        </Link>

        <nav
          aria-label="Navigation principale"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <ul className="flex items-center justify-center gap-0.5 sm:gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavItem {...item} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

/**
 * A navigation destination.
 *
 * Labels appear on medium screens and larger.
 * On smaller screens, icons remain visible with accessible tooltips.
 */

function NavItem({
  to,
  label,
  icon,
  end = false,
}: {
  to: string
  label: string
  icon: IconName
  end?: boolean | undefined
}) {
  return (
    <Tooltip label={label}>
      <NavLink
        to={to}
        end={end}
        aria-label={label}
        className={({ isActive }) =>
          `relative flex h-9 items-center gap-2 rounded-xl px-2 text-[13px] font-medium transition-[background-color,color] duration-200 sm:px-2.5 md:px-3 ${
            isActive
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:bg-surface-2/70 hover:text-ink'
          }`
        }
      >
        <Icon name={icon} size={17} />
        <span className="hidden md:block">{label}</span>
      </NavLink>
    </Tooltip>
  )
}
