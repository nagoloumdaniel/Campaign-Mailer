import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  THEME_STORAGE_KEY,
  ThemeContext,
  type ResolvedTheme,
  type ThemePreference,
} from './context'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Storage throws in a private window and returns null when it is blocked. */
function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

/**
 * Holds the theme for the whole application.
 *
 * The first paint is not this component's doing: public/theme.js has already
 * written the attribute before the bundle parsed. This reads the same storage
 * key back, so the two never disagree, and takes over from there.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setStored] = useState<ThemePreference>(readPreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPreference()))

  /** Writes the theme onto <html>, which is what every token reads from. */
  const apply = useCallback((theme: ResolvedTheme) => {
    document.documentElement.dataset.theme = theme
    // Native controls, scrollbars and form widgets follow this, not the
    // attribute: without it a dark page keeps light scrollbars.
    document.documentElement.style.colorScheme = theme
    setResolved(theme)
  }, [])

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setStored(next)

      try {
        if (next === 'system') {
          localStorage.removeItem(THEME_STORAGE_KEY)
        } else {
          localStorage.setItem(THEME_STORAGE_KEY, next)
        }
      } catch {
        // Blocked storage only costs the choice its persistence; the theme
        // still changes for this visit.
      }

      apply(resolve(next))
    },
    [apply],
  )

  /**
   * Follows the system while, and only while, the preference is `system`.
   * A user who pinned dark does not want their laptop's sunrise to undo it.
   */
  useEffect(() => {
    if (preference !== 'system') {
      return
    }

    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      apply(media.matches ? 'dark' : 'light')
    }

    onChange()
    media.addEventListener('change', onChange)

    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [preference, apply])

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setPreference])

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
