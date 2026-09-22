import express, { Router } from 'express'

import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/auth.js'
import { requireCurrentTerms } from '../middleware/terms.js'
import { createAddressBookRepository } from '../services/addressBook.js'
import { createCampaignRepository } from '../services/campaigns.js'
import { deleteAccount } from '../services/accountDeletion.js'
import { createAuditLog } from '../services/audit.js'
import { createContactRepository } from '../services/contacts.js'
import { createTokenCipher } from '../services/encryption.js'
import { createGoogleTokenRevoker } from '../services/googleRevoke.js'
import { deleteCampaignFiles } from '../services/storage.js'
import { createTermsRepository } from '../services/terms.js'
import { buildUserExport } from '../services/userExport.js'
import { createHistoryRepository } from '../services/history.js'
import { createLogExportRepository } from '../services/logExport.js'
import type { ReadinessReport } from '../services/readiness.js'
import { createStatsRepository } from '../services/stats.js'
import { STARTER_TEMPLATES } from '../services/starterTemplates.js'
import { TEMPLATE_VARIABLES } from '../services/template.js'

import { createAddressBookRouter } from './addressBook.js'
import { createAttachmentRouter } from './attachment.js'
import { authRouter } from './auth.js'
import { createCampaignRouter } from './campaigns.js'
import { createContactRouter } from './contacts.js'
import { createDashboardRouter } from './dashboard.js'
import { createHistoryRouter } from './history.js'
import { createLogExportRouter } from './logExport.js'
import { createReadyRouter } from './ready.js'
import { createStatsRouter } from './stats.js'
import { createUsersRouter } from './users.js'

export interface ApiRouterDeps {
  /**
   * Asks the worker to plan a campaign now. Injected so the API can be built
   * without a queue connection, as the tests do.
   */
  requestDispatch?: ((campaignId: string) => Promise<void>) | undefined
  /** Probes the dependencies for /api/ready. Absent in tests that build the app bare. */
  checkReadiness?: (() => Promise<ReadinessReport>) | undefined
}

/**
 * Every API route mounts here under /api. The stats routes arrive with their
 * phase; see section 6 of the specification for the full surface.
 */
export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const apiRouter = Router()

  /**
   * Liveness. Answers as long as the process is up, and says nothing about
   * whether the database or the queue is reachable: /api/ready does that.
   */
  apiRouter.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
  })

  if (deps.checkReadiness) {
    apiRouter.use('/ready', createReadyRouter(deps.checkReadiness))
  }

  apiRouter.use('/auth', authRouter)

  const audit = createAuditLog(pool)
  const terms = createTermsRepository(pool)

  const deletion = {
    pool,
    cipher: createTokenCipher(env.encryptionKey, env.previousEncryptionKeys),
    revokeGoogleToken: createGoogleTokenRevoker(),
    deleteCampaignFiles,
  }
  apiRouter.use(
    '/users',
    createUsersRouter({
      deleteAccount: (userId) => deleteAccount(deletion, userId),
      exportUser: (userId) => buildUserExport(pool, userId),
      audit,
      acceptTerms: (userId, version) => terms.accept(userId, version),
    }),
  )
  // Everything below this line does the work of the service, and waits on the
  // current terms being accepted. The account routes above do not: exporting
  // and deleting one's data are rights.
  apiRouter.use(
    ['/campaigns', '/contacts', '/dashboard', '/history', '/templates'],
    requireCurrentTerms,
  )

  const campaignRepository = createCampaignRepository(pool)

  apiRouter.use(
    '/campaigns',
    createCampaignRouter(campaignRepository, {
      requestDispatch: deps.requestDispatch,
      accountDailyLimit: env.gmailDailyLimit,
      audit,
    }),
  )
  apiRouter.use('/campaigns/:id/attachments', createAttachmentRouter(campaignRepository))
  apiRouter.use(
    '/history',
    createHistoryRouter({ history: createHistoryRepository(pool) }),
  )
  apiRouter.use(
    '/contacts',
    // A batch of CSV rows is larger than the default body limit, as for a
    // campaign's import.
    express.json({ limit: '5mb' }),
    createAddressBookRouter({ addressBook: createAddressBookRepository(pool) }),
  )
  const statsRepository = createStatsRepository(pool)

  apiRouter.use(
    '/campaigns/:id/stats',
    createStatsRouter({ campaigns: campaignRepository, stats: statsRepository }),
  )
  apiRouter.use(
    '/campaigns/:id/logs/export',
    createLogExportRouter({
      campaigns: campaignRepository,
      logs: createLogExportRepository(pool),
    }),
  )
  apiRouter.use(
    '/dashboard',
    createDashboardRouter({
      campaigns: campaignRepository,
      stats: statsRepository,
      accountDailyLimit: env.gmailDailyLimit,
    }),
  )
  apiRouter.use(
    '/campaigns/:id/contacts',
    // A batch of rows is larger than the default body limit, and raising it
    // globally would let any route accept five megabytes.
    express.json({ limit: '5mb' }),
    createContactRouter({
      campaigns: campaignRepository,
      contacts: createContactRepository(pool),
    }),
  )

  /**
   * The starter templates, served rather than duplicated in the web app, so the
   * variable names in them cannot drift from the ones the merge engine resolves.
   */
  apiRouter.get('/templates', requireAuth, (_req, res) => {
    res.json({ templates: STARTER_TEMPLATES, variables: TEMPLATE_VARIABLES })
  })

  return apiRouter
}
