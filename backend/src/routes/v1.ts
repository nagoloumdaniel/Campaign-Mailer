import express, { Router, type RequestHandler, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'

import { campaignIdParam, signedInUserId } from '../middleware/auth.js'
import {
  integrationTokenId,
  requireIntegrationToken,
  requireScope,
  type IntegrationUserLookup,
} from '../middleware/integrationAuth.js'
import { requireCurrentTerms } from '../middleware/terms.js'
import { buildV1Document } from '../openapi/v1Document.js'
import { validateBody } from '../middleware/validate.js'
import {
  v1AddContactsSchema,
  v1CreateCampaignSchema,
  type V1AddContactsInput,
  type V1CreateCampaignInput,
} from '../schemas/v1.js'
import { canEditContent } from '../services/campaignState.js'
import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import { collectContacts } from '../services/contactImport.js'
import type { ContactRepository } from '../services/contacts.js'
import { requestHash, type IdempotencyRepository } from '../services/idempotency.js'
import type { IntegrationTokenRepository } from '../services/integrationTokens.js'

/** Per token, as the roadmap asks; 60 a minute leaves room for a 10 000-row send. */
export const V1_RATE_LIMIT = { windowMs: 60_000, limit: 60 } as const

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/

export interface V1RouterDeps {
  tokens: IntegrationTokenRepository
  users: IntegrationUserLookup
  campaigns: CampaignRepository
  contacts: ContactRepository
  idempotency: IdempotencyRepository
  /** Where the user finds the draft: the web app, not the API. */
  frontendUrl: string
}

/**
 * The idempotency of every creation. The key is required, not optional: an
 * integration that forgets it would create a second draft on the first retry,
 * and nobody would notice until a campaign went out twice.
 */
function requireIdempotency(idempotency: IdempotencyRepository): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key')

    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      res.status(400).json({
        error:
          'An Idempotency-Key header of 1 to 255 visible ASCII characters is required',
        code: 'idempotency_key_required',
      })
      return
    }

    try {
      const userId = signedInUserId(req)
      const claim = await idempotency.claim(
        userId,
        key,
        requestHash(req.method, req.originalUrl, req.body),
      )

      if (claim.kind === 'mismatch') {
        res.status(422).json({
          error: 'This Idempotency-Key was used for another request',
          code: 'idempotency_key_reused',
        })
        return
      }

      if (claim.kind === 'in_progress') {
        res.setHeader('Retry-After', '1')
        res.status(409).json({
          error: 'A request under this Idempotency-Key is still running',
          code: 'idempotency_key_in_progress',
        })
        return
      }

      if (claim.kind === 'replay') {
        res.setHeader('Idempotent-Replayed', 'true')
        res.status(claim.status).json(claim.body)
        return
      }

      // The response is kept before it leaves, so a caller retrying at once
      // finds it rather than a 409. A server error is not kept.
      const send = res.json.bind(res)
      let settled = false
      res.json = ((body: unknown) => {
        settled = true
        const keep =
          res.statusCode >= 500
            ? idempotency.release(claim.id)
            : idempotency.complete(claim.id, res.statusCode, body)
        keep
          .catch(() => undefined)
          .finally(() => {
            send(body)
          })
        return res
      }) as Response['json']
      res.on('close', () => {
        if (!settled) void idempotency.release(claim.id).catch(() => undefined)
      })
      next()
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error('Idempotency check failed'))
    }
  }
}

function publicCampaign(campaign: CampaignRow, frontendUrl: string) {
  return {
    id: campaign.id,
    name: campaign.name,
    type: campaign.type,
    status: campaign.status,
    url: `${frontendUrl}/campaigns/${campaign.id}`,
  }
}

/**
 * The public API, `/api/v1` (roadmap, Phase 9). Mounted before the session:
 * a program calling it carries a token, never a cookie. A campaign created
 * here stays a draft; only its owner launches it, from the web app.
 */
export function createV1Router(deps: V1RouterDeps): Router {
  const router = Router()

  // The document reads without a token: one should be able to discover the
  // API before having an account. Built once, on the first call.
  let document: object | undefined
  router.get('/openapi.json', (_req, res) => {
    // The web app's domain relays /api in production: it is the API's too.
    document ??= buildV1Document(deps.frontendUrl)
    res.json(document)
  })

  // A batch of 2 000 rows is larger than the general body limit.
  router.use(express.json({ limit: '5mb' }))
  router.use(requireIntegrationToken(deps.tokens, deps.users), requireCurrentTerms)
  router.use(
    rateLimit({
      ...V1_RATE_LIMIT,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (_req, res) => `token:${integrationTokenId(res)}`,
      message: { error: 'Too many requests', code: 'rate_limited' },
    }),
  )

  router.post(
    '/campaigns',
    requireScope('campaigns:write'),
    validateBody(v1CreateCampaignSchema),
    requireIdempotency(deps.idempotency),
    (req, res, next) => {
      void (async () => {
        const input = req.body as V1CreateCampaignInput
        const campaign = await deps.campaigns.create(signedInUserId(req), {
          name: input.name,
          ...(input.type === undefined ? {} : { type: input.type }),
        })
        const result = collectContacts(input.contacts)

        let imported: number
        try {
          imported = await deps.contacts.insertMany(
            campaign.id,
            result.accepted,
            'mailfind',
          )
        } catch (err) {
          // No empty draft left behind by a failed import: the retry, which
          // the idempotency lets through after a server error, starts clean.
          await deps.campaigns.remove(campaign.id)
          throw err
        }

        res.status(201).json({
          campaign: publicCampaign(campaign, deps.frontendUrl),
          report: { read: result.summary.read, imported, rejected: result.rejected },
        })
      })().catch(next)
    },
  )

  router.post(
    '/campaigns/:id/contacts',
    requireScope('contacts:write'),
    validateBody(v1AddContactsSchema),
    requireIdempotency(deps.idempotency),
    (req, res, next) => {
      void (async () => {
        const id = campaignIdParam(req)
        const campaign = id
          ? await deps.campaigns.findForUser(id, signedInUserId(req))
          : null

        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found' })
          return
        }

        if (!canEditContent(campaign.status)) {
          res.status(409).json({
            error: 'This campaign no longer accepts new contacts',
            code: 'campaign_not_editable',
          })
          return
        }

        const input = req.body as V1AddContactsInput
        const existing = await deps.contacts.existingEmails(campaign.id)
        const result = collectContacts(input.contacts, { existing })
        const imported = await deps.contacts.insertMany(
          campaign.id,
          result.accepted,
          'mailfind',
        )

        res.status(201).json({
          campaign: publicCampaign(campaign, deps.frontendUrl),
          report: { read: result.summary.read, imported, rejected: result.rejected },
        })
      })().catch(next)
    },
  )

  // An unknown route stops here, without falling through to the session.
  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  return router
}
