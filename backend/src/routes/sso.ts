import crypto from 'node:crypto'

import { Router } from 'express'
import { z } from 'zod'

import { logger } from '../logger.js'
import {
  createSsoExchange,
  PENDING_COOKIE,
  secretMatches,
  STATE_PATTERN,
  type SsoCodeRepository,
  type SsoConfig,
  type SsoExchange,
} from '../services/sso.js'
import type { UserRepository, UserRow } from '../services/users.js'

declare module 'express-session' {
  interface SessionData {
    /** The state of a sign-in through MailFind in progress. */
    ssoState?: string
  }
}

/** Ten minutes to sign in here before going back to MailFind. */
const PENDING_MAX_AGE_MS = 10 * 60 * 1000

const tokenBodySchema = z.object({ code: z.string().max(200) })

export interface SsoProviderDeps {
  codes: SsoCodeRepository
  /** Null when the feature is off. */
  config: SsoConfig | null
}

/**
 * The code exchange, server to server (MailFind decision D-26). Mounted before
 * the session: MailFind carries no cookie, only the shared secret.
 */
export function createSsoTokenRouter({ codes, config }: SsoProviderDeps): Router {
  const router = Router()

  router.post('/token', (req, res, next) => {
    if (!config) {
      res
        .status(404)
        .json({ error: 'Sign-in with MailFind is not configured', code: 'not_found' })
      return
    }

    const header = req.get('authorization') ?? ''
    const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

    if (!secretMatches(provided, config.secret)) {
      res.status(401).json({ error: 'Secret refused', code: 'invalid_client' })
      return
    }

    const body = tokenBodySchema.safeParse(req.body)

    ;(body.success ? codes.consume(body.data.code) : Promise.resolve(null))
      .then((user) => {
        if (!user) {
          // Unknown, spent or expired: one answer for all three, nothing to
          // learn by telling them apart.
          res.status(400).json({ error: 'Code refused', code: 'invalid_grant' })
          return
        }

        res.set('cache-control', 'no-store')
        // No name: this application does not keep one.
        res.json({ google_id: user.google_id, email: user.email, name: null })
      })
      .catch(next)
  })

  return router
}

/**
 * MailFind's request, in the browser. The person must be signed in here, or
 * goes through Google first and comes back. The redirect only ever goes to
 * MailFind's configured address: no return URL is read from the request.
 */
export function createSsoAuthorizeRouter({ codes, config }: SsoProviderDeps): Router {
  const router = Router()

  router.get('/authorize', (req, res, next) => {
    if (!config) {
      res
        .status(404)
        .json({ error: 'Sign-in with MailFind is not configured', code: 'not_found' })
      return
    }

    const state = req.query.state

    if (typeof state !== 'string' || !STATE_PATTERN.test(state)) {
      res.status(400).json({ error: 'Invalid sign-in request', code: 'invalid_state' })
      return
    }

    if (!req.isAuthenticated()) {
      res.cookie(PENDING_COOKIE, state, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'lax',
        maxAge: PENDING_MAX_AGE_MS,
        path: '/api',
      })
      res.redirect('/api/auth/google')
      return
    }

    codes
      .issue((req.user as UserRow).id)
      .then((code) => {
        const back = new URL(`${config.partnerUrl}/api/auth/campaign-mailer/callback`)
        back.searchParams.set('code', code)
        back.searchParams.set('state', state)
        res.redirect(back.toString())
      })
      .catch(next)
  })

  return router
}

export interface MailfindSignInDeps {
  users: Pick<UserRepository, 'upsertFromPartner'>
  config: SsoConfig | null
  frontendUrl: string
  /** The code exchange; tests put a fake MailFind here. */
  exchange?: SsoExchange | undefined
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'

/**
 * "Se connecter avec MailFind". MailFind vouches for the person's Google
 * identity; the account is found by that id, the same as a direct Google
 * sign-in, and created only when it does not exist. An address another Google
 * id holds is refused rather than linked.
 */
export function createMailfindSignInRouter(deps: MailfindSignInDeps): Router {
  const router = Router()
  const failure = (code: string) => `${deps.frontendUrl}/login?error=${code}`

  router.get('/', (req, res, next) => {
    if (!deps.config) {
      res.redirect(failure('mailfind-unavailable'))
      return
    }

    const state = crypto.randomBytes(32).toString('base64url')
    req.session.ssoState = state
    const target = new URL(`${deps.config.partnerUrl}/api/sso/authorize`)
    target.searchParams.set('state', state)

    req.session.save((err) => {
      if (err) {
        next(err)
        return
      }

      res.redirect(target.toString())
    })
  })

  router.get('/callback', (req, res) => {
    const expected = req.session.ssoState
    delete req.session.ssoState
    const { code, state } = req.query

    // The state ties this return to the browser that began the sign-in;
    // without it, a third party could open their own session here.
    if (
      !deps.config ||
      expected === undefined ||
      typeof state !== 'string' ||
      !STATE_PATTERN.test(state) ||
      !secretMatches(state, expected) ||
      typeof code !== 'string'
    ) {
      res.redirect(failure('mailfind'))
      return
    }

    const exchange = deps.exchange ?? createSsoExchange(deps.config)

    exchange(code)
      .then((identity) =>
        deps.users.upsertFromPartner({
          googleId: identity.google_id,
          email: identity.email,
        }),
      )
      .then((user) => {
        req.login(user, (err) => {
          if (err) {
            logger.error(
              { error: err instanceof Error ? err.message : 'unknown' },
              'MailFind sign-in failed',
            )
            res.redirect(failure('mailfind'))
            return
          }

          res.redirect(deps.frontendUrl)
        })
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          res.redirect(failure('mailfind-conflict'))
          return
        }

        logger.error(
          { error: err instanceof Error ? err.message : 'unknown error' },
          'MailFind sign-in failed',
        )
        res.redirect(failure('mailfind'))
      })
  })

  return router
}
