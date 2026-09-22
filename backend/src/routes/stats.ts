import { Router } from 'express'

import { campaignIdParam, requireAuth, signedInUserId } from '../middleware/auth.js'
import { estimateSchedule } from '../services/campaignStats.js'
import type { CampaignRepository } from '../services/campaigns.js'
import type { StatsRepository } from '../services/stats.js'

export interface StatsRouterDeps {
  campaigns: CampaignRepository
  stats: StatsRepository
  /** Injected so a test can pin the estimate. */
  now?: (() => Date) | undefined
}

/**
 * GET /api/campaigns/:id/stats — where one campaign stands.
 *
 * Scoped like every campaign route: resolved for the signed-in user first, so
 * another user's campaign is not found rather than forbidden.
 */
export function createStatsRouter({ campaigns, stats, now }: StatsRouterDeps): Router {
  // mergeParams, or :id from the parent mount is not visible here.
  const router = Router({ mergeParams: true })

  router.use(requireAuth)

  router.get('/', (req, res, next) => {
    void (async () => {
      const id = campaignIdParam(req)
      const campaign = id ? await campaigns.findForUser(id, signedInUserId(req)) : null

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      const [counts, window, perDay] = await Promise.all([
        stats.contactCounts(campaign.id),
        stats.sendWindow(campaign.id),
        stats.sendsPerDay(campaign.id, campaign.timezone),
      ])

      const schedule = estimateSchedule({
        now: now?.() ?? new Date(),
        status: campaign.status,
        pending: counts.pending,
        mailsPerDay: campaign.mails_per_day,
        pauseMs: campaign.pause_ms,
        startHour: campaign.start_hour,
        timezone: campaign.timezone,
        sentLast24h: window.sentLast24h,
        oldestSendInWindowAt: window.oldestInWindowAt,
        lastSentAt: window.lastSentAt,
        nextPlannedAt: window.nextPlannedAt,
      })

      const processed = counts.sent + counts.failed

      res.json({
        stats: {
          ...counts,
          // Over what was attempted, not over the whole list: a campaign that
          // has sent 2 and failed 1 has a third of its sends failing, not 1 %.
          errorRate: processed > 0 ? counts.failed / processed : null,
          lastSentAt: window.lastSentAt?.toISOString() ?? null,
          nextSendAt: schedule.nextSendAt?.toISOString() ?? null,
          estimatedEndAt: schedule.estimatedEndAt?.toISOString() ?? null,
          perDay,
        },
      })
    })().catch(next)
  })

  return router
}
