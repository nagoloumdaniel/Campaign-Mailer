import { Router, type RequestHandler } from 'express'
import passport from 'passport'

import { env } from '../config/env.js'
import { SESSION_COOKIE_NAME } from '../config/session.js'
import { buildAuthorizationOptions } from '../services/googleAuth.js'
import { PENDING_COOKIE, readCookie, STATE_PATTERN } from '../services/sso.js'
import { toPublicUser, type UserRow } from '../services/users.js'

export const authRouter = Router()

/**
 * @types/passport declares authenticate as returning `any`, which makes every
 * use of it an unsafe argument. Naming the type here keeps the rule on for the
 * rest of the file instead of exempting it.
 */
const authenticate = passport.authenticate.bind(passport) as (
  strategy: string,
  options?: Record<string, unknown>,
) => RequestHandler

/**
 * Starts the OAuth flow. A plain redirect to Google, carrying the scopes and
 * the offline/consent parameters.
 */
authRouter.get('/google', authenticate('google', buildAuthorizationOptions()))

/**
 * Where Google sends the browser back.
 *
 * GET, although section 6 of the specification writes POST. An OAuth redirect
 * is a browser navigation, so Google can only issue a GET here; a POST route
 * would never be reached.
 *
 * On success and on failure the user lands back in the web application rather
 * than on a JSON body, because a human is looking at this response.
 */
authRouter.get(
  '/google/callback',
  authenticate('google', {
    failureRedirect: `${env.frontendUrl}/login?error=google`,
    session: true,
  }),
  (req, res) => {
    // MailFind was waiting on this sign-in for a code (routes/sso.ts): go
    // back there rather than to the dashboard.
    const pending = readCookie(req, PENDING_COOKIE)

    if (pending !== undefined && STATE_PATTERN.test(pending)) {
      res.clearCookie(PENDING_COOKIE, { path: '/api' })
      res.redirect(`/api/sso/authorize?state=${encodeURIComponent(pending)}`)
      return
    }

    res.redirect(env.frontendUrl)
  },
)

/**
 * Signs out.
 *
 * POST, although section 6 of the specification writes GET. A GET that
 * destroys a session can be fired by any page on the internet with an
 * `<img src>`, which logs the user out without their involvement.
 */
authRouter.post('/logout', (req, res, next) => {
  req.logout((logoutErr) => {
    if (logoutErr) {
      next(logoutErr)
      return
    }

    // Passport clears the login state; destroying the session removes the
    // Redis entry so the id cannot be replayed.
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        next(destroyErr)
        return
      }

      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      res.status(204).end()
    })
  })
})

/** The signed-in user, or 401. Never any token, see toPublicUser. */
authRouter.get('/me', (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  res.json({ user: toPublicUser(req.user as UserRow) })
})
