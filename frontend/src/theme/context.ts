import { createContext } from 'react'

/**
 * What the user chose, which is not the same thing as what is on screen.
 *
 * `system` follows the operating system and keeps following it, so a laptop
 * that turns dark in the evening turns the application dark with it. The two
 * explicit values pin it. Storing "system" rather than resolving it once is
 * what makes that possible.
 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** What is actually painted. Always one of two. */
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  /** Flips between the two visible themes, whatever the preference was. */
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Shared with public/theme.js, which reads it before the bundle loads. */
export const THEME_STORAGE_KEY = 'cm-theme'
