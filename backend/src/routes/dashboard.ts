import { Router } from 'express'

import { requireAuth, signedInUserId } from '../middleware/auth.js'
import { dashboardQuerySchema } from '../schemas/dashboard.js'
import type { CampaignStatus } from '../services/campaignState.js'
import { CAMPAIGN_STATUSES } from '../services/campaignState.js'
import { estimateSchedule } from '../services/campaignStats.js'
import type { CampaignRepository } from '../services/campaigns.js'
import type { StatsRepository } from '../services/stats.js'

export interface DashboardRouterDeps {
  campaigns: CampaignRepository
  stats: StatsRepository
  /** The account's ceiling over 24 hours. */
  accountDailyLimit: number
  now?: (() => Date) | undefined
}

/**
 * GET /api/dashboard — the whole account at a glance.
 *
 * Three questions, in the order a user asks them: how many campaigns and in
 * what state, how much of today's allowance is left, and what goes out next.
 *
 * The upcoming list costs a few queries per sending campaign. A user has a
 * handful of those at most, and a single aggregate query would duplicate the
 * estimate's rules in SQL, where they would drift from the planner's.
 */
export function createDashboardRouter({
  campaigns,
  stats,
  accountDailyLimit,
  now,
}: DashboardRouterDeps): Router {
  const router = Router()

  router.use(requireAuth)

  const userId = signedInUserId

  router.get('/', (req, res, next) => {
    void (async () => {
      const query = dashboardQuerySchema.safeParse(req.query)

      if (!query.success) {
        res.status(400).json({ error: 'Invalid query' })
        return
      }

      const rows = await campaigns.listForUser(userId(req))
      const at = now?.() ?? new Date()

      const byStatus = new Map<CampaignStatus, number>(
        CAMPAIGN_STATUSES.map((status) => [status, 0]),
      )
      for (const row of rows) {
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1)
      }

      const sending = rows.filter(
        (row) => row.status === 'running' || row.status === 'scheduled',
      )

      const upcoming = await Promise.all(
        sending.map(async (row) => {
          const [counts, window] = await Promise.all([
            stats.contactCounts(row.id),
            stats.sendWindow(row.id),
          ])

          const schedule = estimateSchedule({
            now: at,
            status: row.status,
            pending: counts.pending,
            mailsPerDay: row.mails_per_day,
            pauseMs: row.pause_ms,
            startHour: row.start_hour,
            timezone: row.timezone,
            sentLast24h: window.sentLast24h,
            oldestSendInWindowAt: window.oldestInWindowAt,
            lastSentAt: window.lastSentAt,
          })

          return {
            campaignId: row.id,
            name: row.name,
            status: row.status,
            pending: counts.pending,
            nextSendAt: schedule.nextSendAt,
            estimatedEndAt: schedule.estimatedEndAt,
          }
        }),
      )

      const [sentLast24h, perDay] = await Promise.all([
        campaigns.accountSentLast24h(userId(req)),
        // Two weeks: long enough to show a campaign's rhythm, short enough
        // that the line still means "lately".
        stats.accountSendsPerDay(userId(req), query.data.timezone, 14),
      ])

      res.json({
        dashboard: {
          campaigns: {
            total: rows.length,
            byStatus: Object.fromEntries(byStatus),
          },
          account: {
            sentLast24h,
            dailyLimit: accountDailyLimit,
            remaining: Math.max(0, accountDailyLimit - sentLast24h),
            perDay,
          },
          // Soonest first; a campaign with nothing left to send has no next
          // send and goes last.
          upcoming: upcoming
            .sort(
              (a, b) =>
                (a.nextSendAt?.getTime() ?? Number.POSITIVE_INFINITY) -
                (b.nextSendAt?.getTime() ?? Number.POSITIVE_INFINITY),
            )
            .map((item) => ({
              ...item,
              nextSendAt: item.nextSendAt?.toISOString() ?? null,
              estimatedEndAt: item.estimatedEndAt?.toISOString() ?? null,
            })),
        },
      })
    })().catch(next)
  })

  return router
}
