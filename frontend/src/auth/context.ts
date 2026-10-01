import { createContext } from 'react'

export interface CurrentUser {
  id: string
  email: string
  createdAt: string
  /** The version of the terms accepted, or null before the first acceptance. */
  termsVersion: string | null
  /**
   * False for an account created through MailFind until Google grants sending.
   * Optional so an older API answer reads as "unknown", never as "missing".
   */
  gmailConnected?: boolean
}

/**
 * Four states, not a boolean plus a flag.
 *
 * `loading` is a real state, not the absence of a user: rendering the login
 * page while the session is still being checked flashes it in front of someone
 * who is already signed in.
 *
 * `unreachable` is separate from `anonymous` because they call for opposite
 * responses. Anonymous means sign in; unreachable means the server did not
 * answer, and showing a login page then tells the user to do something that
 * cannot work, and makes them suspect their own account.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

export interface AuthContextValue {
  status: AuthStatus
  user: CurrentUser | null
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
