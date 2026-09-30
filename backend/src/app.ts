import cors from 'cors'
import express, { type Express } from 'express'
import rateLimit from 'express-rate-limit'
import session, { type Store } from 'express-session'
import helmet from 'helmet'

import { env, isProduction } from './config/env.js'
import { configurePassport } from './config/passport.js'
import {
  RATE_LIMIT,
  buildCorsOptions,
  buildHelmetOptions,
  rateLimitKey,
} from './config/security.js'
import { createRequestLogger } from './config/requestLogging.js'
import { buildSessionOptions } from './config/session.js'
import { logger } from './logger.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { createApiRouter, type ApiRouterDeps } from './routes/index.js'
import { createV1Router } from './routes/v1.js'
import { pool } from './db/pool.js'
import { createCampaignRepository } from './services/campaigns.js'
import { createContactRepository } from './services/contacts.js'
import { createIdempotencyRepository } from './services/idempotency.js'
import { createIntegrationTokenRepository } from './services/integrationTokens.js'
import { createUserRepository } from './services/users.js'

export interface AppDeps extends ApiRouterDeps {
  /** Injected so tests can build the app without a Redis connection. */
  sessionStore: Store
}

/**
 * Builds the Express application without starting a server, so tests can
 * drive it in-process.
 *
 * Security middleware belongs here and lands in Phase 1: helmet, CORS
 * restricted to FRONTEND_URL, the Redis-backed session, and the per-user rate
 * limit.
 */
export function createApp({
  sessionStore,
  requestDispatch,
  checkReadiness,
}: AppDeps): Express {
  const app = express()

  // Behind Railway's proxy, and in production Vercel's relay too, so req.ip and
  // secure cookies need the hops counted. See TRUST_PROXY_HOPS in config/env.ts.
  app.set('trust proxy', env.trustProxyHops)
  app.disable('x-powered-by')

  // Before anything else, so every request, refused ones included, gets an id
  // and a log line.
  app.use(createRequestLogger(logger))

  // Next, so the headers are present on every response including errors.
  app.use(helmet(buildHelmetOptions(isProduction)))
  app.use(cors(buildCorsOptions(env.frontendUrl)))

  // The v1 API before the body parser and the session: a program calling it
  // carries a token, never a cookie, and a batch of 2 000 rows would not get
  // past the general 1 MB limit. It reads its own body.
  app.use(
    '/api/v1',
    createV1Router({
      tokens: createIntegrationTokenRepository(pool),
      users: createUserRepository(pool),
      campaigns: createCampaignRepository(pool),
      contacts: createContactRepository(pool),
      idempotency: createIdempotencyRepository(pool),
      frontendUrl: env.frontendUrl,
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))

  app.use(
    session(
      buildSessionOptions({
        secret: env.sessionSecret,
        isProduction,
        store: sessionStore,
      }),
    ),
  )

  const passport = configurePassport()
  app.use(passport.initialize())
  app.use(passport.session())

  // After Passport, so the key can be the account rather than the address.
  // The cost is that a request carrying a cookie is looked up in Redis before
  // being counted, which is the price of not punishing everyone behind one
  // office address.
  app.use(
    '/api',
    rateLimit({
      ...RATE_LIMIT,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: rateLimitKey,
      message: { error: 'Too many requests' },
    }),
  )

  app.use('/api', createApiRouter({ requestDispatch, checkReadiness }))

  app.use(notFound)
  app.use(errorHandler)

  return app
}
