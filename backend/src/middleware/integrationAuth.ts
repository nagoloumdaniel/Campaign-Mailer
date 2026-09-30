import type { RequestHandler, Response } from 'express'

import {
  hashToken,
  looksLikeToken,
  type IntegrationScope,
  type IntegrationTokenRepository,
} from '../services/integrationTokens.js'

export interface IntegrationUserLookup {
  /** The account as the session would carry it: the terms gate reads it. */
  findById(id: string): Promise<{ id: string; terms_version?: string | null } | null>
}

/** The token's scopes, set by requireIntegrationToken. */
export function integrationScopes(res: Response): IntegrationScope[] {
  return (res.locals.integrationScopes as IntegrationScope[] | undefined) ?? []
}

/** The token's id, the key of its own rate limit. */
export function integrationTokenId(res: Response): string {
  return res.locals.integrationTokenId as string
}

/**
 * Authenticates a v1 request by its `Authorization: Bearer cm_...` token and
 * puts the account on `req.user`, as the session would: the routes and the
 * terms gate behind do not know which door the request came through.
 *
 * A missing, malformed, unknown or revoked token gets the same answer: telling
 * them apart would help whoever is guessing.
 */
export function requireIntegrationToken(
  tokens: IntegrationTokenRepository,
  users: IntegrationUserLookup,
): RequestHandler {
  return async (req, res, next) => {
    const refuse = () => {
      res.setHeader('WWW-Authenticate', 'Bearer realm="Campaign Mailer"')
      res.status(401).json({ error: 'Invalid integration token', code: 'invalid_token' })
    }

    const [scheme, secret] = (req.get('authorization') ?? '').split(' ')

    if (scheme?.toLowerCase() !== 'bearer' || !secret || !looksLikeToken(secret)) {
      refuse()
      return
    }

    try {
      const token = await tokens.findActive(hashToken(secret))
      const user = token ? await users.findById(token.userId) : null

      if (!token || !user) {
        refuse()
        return
      }

      await tokens.touch(token.id)
      req.user = user
      res.locals.integrationScopes = token.scopes
      res.locals.integrationTokenId = token.id
      next()
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error('Token check failed'))
    }
  }
}

export function requireScope(scope: IntegrationScope): RequestHandler {
  return (_req, res, next) => {
    if (!integrationScopes(res).includes(scope)) {
      res.status(403).json({
        error: `This token lacks the ${scope} scope`,
        code: 'insufficient_scope',
      })
      return
    }
    next()
  }
}
