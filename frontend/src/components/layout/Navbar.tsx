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
 * It sits over the page rather than on top of it: a translucent bar with a
 * blur behind it, held up by a hairline, so the content scrolling underneath
 * stays visible and the bar reads as a layer rather than as a lid. The border
 * and the shadow only appear once the page has actually scrolled — at the top
 * there is nothing to separate it from, and a permanent shadow there is the
 * detail that makes an interface look printed on.
 *
 * Three destinations and no more. Everything else in the application is
 * reached from one of them, and a navigation with seven entries is a
 * navigation nobody reads.
 */

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Accueil', icon: 'home', end: true },
  { to: '/campaigns', label: 'Campagnes', icon: 'send' },
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
        className={`mx-auto flex h-14 max-w-6xl items-center gap-2 rounded-2xl glass px-2.5 transition-[box-shadow,border-color] duration-300 ease-out sm:gap-3 sm:px-3.5 ${
          scrolled
            ? 'border border-border shadow-card'
            : 'border border-transparent shadow-none'
        }`}
      >
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 rounded-lg pr-1 pl-1 text-ink"
          aria-label="Campaign Mailer, accueil"
        >
          <Logo size={26} />
          {/* The name disappears first when space runs out: the mark alone
              still identifies the product, a truncated name does not. */}
          <span className="hidden font-display text-[15px] font-semibold tracking-tight sm:block">
            Campaign&nbsp;Mailer
          </span>
        </Link>

        <nav aria-label="Navigation principale" className="ms-1 min-w-0 sm:ms-3">
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavItem {...item} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

/**
 * A destination.
 *
 * The label is text on a tablet and up, and an icon below that, where the bar
 * would otherwise overflow — with the same word as a tooltip and as the
 * accessible name, so nothing is lost, only folded. The active entry is
 * marked by a filled pill as well as by colour, because colour alone is not a
 * signal everyone receives.
 */
function NavItem({
  to,
  label,
  icon,
  // Defaulted rather than forwarded as `undefined`: NavLink's own prop is not
  // optional-undefined, and `exactOptionalPropertyTypes` is on.
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
          `relative flex h-9 press items-center gap-2 rounded-xl px-2.5 text-[13px] font-medium md:px-3 ${
            isActive
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
          }`
        }
      >
        <Icon name={icon} size={17} />
        <span className="hidden md:block">{label}</span>
      </NavLink>
    </Tooltip>
  )
}
