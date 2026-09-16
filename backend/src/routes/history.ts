import { Router } from 'express'

import { requireAuth, signedInUserId } from '../middleware/auth.js'
import { historyQuerySchema, type HistoryQueryInput } from '../schemas/history.js'
import {
  historyToCsv,
  type HistoryRepository,
  type HistoryRow,
} from '../services/history.js'

export interface HistoryRouterDeps {
  history: HistoryRepository
}

/**
 * GET /api/history — every message this account has sent, newest first.
 *
 * One page across every campaign, rather than a log per campaign, because the
 * question it answers is "have I already written to this company", and that
 * question does not know which campaign the answer is in.
 */
export function createHistoryRouter({ history }: HistoryRouterDeps): Router {
  const router = Router()

  router.use(requireAuth)

  /** The validated query, or null once a 400 has been answered. */
  const parse = (
    raw: unknown,
    res: { status: (code: number) => { json: (body: unknown) => unknown } },
  ): HistoryQueryInput | null => {
    const parsed = historyQuerySchema.safeParse(raw)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query' })
      return null
    }

    return parsed.data
  }

  router.get('/', (req, res, next) => {
    void (async () => {
      const query = parse(req.query, res)

      if (!query) {
        return
      }

      const page = await history.list(signedInUserId(req), query)

      res.json({
        history: page.rows.map(toPublicEntry),
        total: page.total,
        byType: page.byType,
        limit: query.limit,
        offset: query.offset,
      })
    })().catch(next)
  })

  router.get('/export', (req, res, next) => {
    void (async () => {
      const query = parse(req.query, res)

      if (!query) {
        return
      }

      const rows = await history.all(signedInUserId(req), query)
      const csv = historyToCsv(rows, query.timezone)

      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader('content-disposition', 'attachment; filename="historique-envois.csv"')
      // The file holds recipients' addresses; no shared cache should keep a copy.
      res.setHeader('cache-control', 'no-store')
      res.send(csv)
    })().catch(next)
  })

  return router
}

/** The shape a client sees. Ids stay, so a selection can become a follow-up. */
function toPublicEntry(row: HistoryRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    campaignType: row.campaign_type,
    subject: row.campaign_subject,
    contactId: row.contact_id,
    email: row.email,
    contactName: row.contact_name,
    companyName: row.company_name,
    outcome: row.outcome,
    message: row.message,
    sentAt: row.created_at.toISOString(),
  }
}
