import { useTheme } from '@/theme/useTheme'

import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * One button, not three.
 *
 * The navigation is not where a three-way choice belongs: the thing a person
 * wants from a theme control in a header is the other theme, now. The full
 * choice — light, dark, or follow the system — lives on the account page,
 * where there is room to say what "système" means.
 *
 * The two glyphs cross-fade in place rather than swapping, so the button does
 * not blink on every press.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolved, toggle } = useTheme()
  const goingDark = resolved === 'light'
  const label = goingDark ? 'Passer en thème sombre' : 'Passer en thème clair'

  return (
    <Tooltip label={label} align="end">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className={`relative flex size-9 press items-center justify-center rounded-xl text-ink-muted hover:bg-surface-2 hover:text-ink ${className}`}
      >
        <Icon
          name="sun"
          size={17}
          className={`absolute transition-[opacity,transform] duration-300 ease-out ${
            goingDark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0'
          }`}
        />
        <Icon
          name="moon"
          size={17}
          className={`absolute transition-[opacity,transform] duration-300 ease-out ${
            goingDark ? 'scale-50 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
          }`}
        />
      </button>
    </Tooltip>
  )
}
