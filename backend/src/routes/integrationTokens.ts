import { Router } from 'express'
import { z } from 'zod'

import { isUuid, requireAuth, signedInUserId } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import type { AuditLog } from '../services/audit.js'
import {
  INTEGRATION_SCOPES,
  MAX_ACTIVE_TOKENS,
  type IntegrationTokenRepository,
} from '../services/integrationTokens.js'

export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1),
  })
  .strict()

export interface IntegrationTokenRouterDeps {
  tokens: IntegrationTokenRepository
  audit?: AuditLog | undefined
}

/**
 * Integration tokens, managed from the account page. These routes go through
 * the session, never through a token: a token cannot create or revoke another.
 */
export function createIntegrationTokenRouter({
  tokens,
  audit,
}: IntegrationTokenRouterDeps): Router {
  const router = Router()

  router.use(requireAuth)

  router.get('/', (req, res, next) => {
    void (async () => {
      res.json({
        tokens: await tokens.list(signedInUserId(req)),
        max_active: MAX_ACTIVE_TOKENS,
      })
    })().catch(next)
  })

  router.post('/', validateBody(createTokenSchema), (req, res, next) => {
    void (async () => {
      const userId = signedInUserId(req)
      const { name, scopes } = req.body as z.infer<typeof createTokenSchema>
      const result = await tokens.create(userId, name, scopes)

      if (result.kind === 'limit_reached') {
        res.status(409).json({
          error: `Revoke a token before creating another (${String(MAX_ACTIVE_TOKENS)} at most)`,
        })
        return
      }

      await audit?.record(userId, 'integration_token.created', result.token.id)
      // The secret is never returned again: no cache, no log.
      res.setHeader('Cache-Control', 'no-store')
      res.status(201).json({ token: result.token, secret: result.secret })
    })().catch(next)
  })

  router.delete('/:id', (req, res, next) => {
    void (async () => {
      const userId = signedInUserId(req)
      const id = req.params.id
      const revoked = isUuid(id) ? await tokens.revoke(userId, id) : null

      if (!revoked) {
        res.status(404).json({ error: 'Token not found' })
        return
      }

      await audit?.record(userId, 'integration_token.revoked', revoked.id)
      res.json({ token: revoked })
    })().catch(next)
  })

  return router
}
