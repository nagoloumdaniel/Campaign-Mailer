import { Router } from 'express'

import { logger } from '../logger.js'
import { campaignIdParam, requireAuth, signedInUserId } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  CADENCE_FIELDS,
  CONTENT_FIELDS,
  createCampaignSchema,
  followUpSchema,
  insideSendingWindow,
  previewSchema,
  startCampaignSchema,
  updateCampaignSchema,
  type CreateCampaignInput,
  type FollowUpInput,
  type PreviewInput,
  type UpdateCampaignInput,
} from '../schemas/campaign.js'
import {
  canDelete,
  canEditCadence,
  canEditContent,
  canTransition,
  type CampaignStatus,
} from '../services/campaignState.js'
import type { AuditAction, AuditLog } from '../services/audit.js'
import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import { renderPreview, type PreviewSource } from '../services/preview.js'

export interface CampaignRouterOptions {
  /**
   * Asks the worker to plan a campaign now rather than at its next scheduled
   * pass. Optional so the router can be built without a queue.
   */
  requestDispatch?: ((campaignId: string) => Promise<void>) | undefined
  /**
   * The account's ceiling over 24 hours. Returned with a single campaign so the
   * interface can say when the ceiling, not a fault, is what holds the sending.
   */
  accountDailyLimit?: number | undefined
  /** Records who started, paused or resumed which campaign. */
  audit?: AuditLog | undefined
}

/**
 * Section 6 of the specification, for campaigns.
 *
 * Every route is behind `requireAuth`, and every query is scoped by the
 * signed-in user's id rather than filtered afterwards: a campaign belonging to
 * someone else is simply not found, which is the same answer as one that never
 * existed.
 */
export function createCampaignRouter(
  campaigns: CampaignRepository,
  options: CampaignRouterOptions = {},
): Router {
  const router = Router()

  router.use(requireAuth)

  const userId = signedInUserId
  const paramId = campaignIdParam

  /**
   * A campaign with its attachments and its account's sending over the last 24
   * hours.
   *
   * Only on single-campaign answers: the list would pay two extra queries per
   * row for numbers nobody reads there.
   */
  const withSending = async (row: CampaignRow) => {
    const [sentLast24h, attachments] = await Promise.all([
      campaigns.accountSentLast24h(row.user_id),
      campaigns.listAttachments(row.id),
    ])

    return {
      ...toPublicCampaign(row),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size_bytes,
        contentType: attachment.content_type,
        createdAt: attachment.created_at.toISOString(),
      })),
      sending: {
        accountSentLast24h: sentLast24h,
        accountDailyLimit: options.accountDailyLimit ?? null,
      },
    }
  }

  router.get('/', (req, res, next) => {
    campaigns
      .listForUser(userId(req))
      .then((rows) => {
        res.json({ campaigns: rows.map(toPublicCampaign) })
      })
      .catch(next)
  })

  router.post('/', validateBody(createCampaignSchema), (req, res, next) => {
    const input = req.body as CreateCampaignInput

    campaigns
      .create(userId(req), input)
      .then((row) => {
        res.status(201).json({ campaign: toPublicCampaign(row) })
      })
      .catch(next)
  })

  /**
   * A follow-up campaign, built from contacts already written to.
   *
   * Declared before `/:id`, or Express would read "follow-up" as a campaign id
   * and answer 404. The contacts are copied server-side: asking the user to
   * export the addresses they just selected and import them back would be the
   * one step this whole page exists to remove.
   */
  router.post('/follow-up', validateBody(followUpSchema), (req, res, next) => {
    void (async () => {
      const input = req.body as FollowUpInput

      const { campaign, imported } = await campaigns.createFollowUp(userId(req), {
        name: input.name,
        type: input.type ?? 'relance',
        contactIds: input.contact_ids,
      })

      if (imported === 0) {
        // Nothing was copied: every id named a contact of somebody else, or one
        // that has since been deleted. An empty campaign would be a puzzle, so
        // it is removed and the refusal says what happened.
        await campaigns.remove(campaign.id)
        res.status(404).json({ error: 'None of these contacts could be found' })
        return
      }

      res.status(201).json({ campaign: toPublicCampaign(campaign), imported })
    })().catch(next)
  })

  router.get('/:id', (req, res, next) => {
    void (async () => {
      const id = paramId(req)
      const row = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!row) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      res.json({ campaign: await withSending(row) })
    })().catch(next)
  })

  router.patch('/:id', validateBody(updateCampaignSchema), (req, res, next) => {
    void (async () => {
      const patch = req.body as UpdateCampaignInput
      const id = paramId(req)
      const current = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!current) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      const refusal = refuseEdit(current, patch)

      if (refusal) {
        // 409, not 400: the payload was fine, the campaign had moved on.
        res.status(409).json({ error: refusal })
        return
      }

      const updated = await campaigns.update(current.id, patch)

      res.json({ campaign: toPublicCampaign(updated ?? current) })
    })().catch(next)
  })

  /**
   * Renders the campaign as a recipient would receive it.
   *
   * POST rather than GET because the payload may carry made-up values, and a
   * body is the honest place for them. Nothing is stored.
   */
  router.post('/:id/preview', validateBody(previewSchema), (req, res, next) => {
    void (async () => {
      const input = req.body as PreviewInput
      const id = paramId(req)
      const campaign = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      let source: PreviewSource | undefined = input.contact

      if (input.contact_id) {
        const contact = await campaigns.findContact(campaign.id, input.contact_id)

        if (!contact) {
          res.status(404).json({ error: 'Contact not found in this campaign' })
          return
        }

        source = contact
      }

      res.json({ preview: renderPreview(campaign, source) })
    })().catch(next)
  })

  /**
   * Hands the campaign to the worker straight away.
   *
   * A failure here is logged, not returned: the status change is already
   * stored, and the scheduled pass plans every scheduled or running campaign
   * within fifteen minutes. A queue outage delays a start; it does not lose it,
   * and answering 500 would invite a second click on something that worked.
   */
  const dispatchSoon = async (campaignId: string): Promise<void> => {
    if (!options.requestDispatch) {
      return
    }

    try {
      await options.requestDispatch(campaignId)
    } catch (err) {
      logger.error({ err, campaignId }, 'Could not request an immediate dispatch')
    }
  }

  /**
   * One route per move in the state machine that a user may make.
   *
   * The graph is checked for a readable 409, then the move is made with a
   * conditional update, so a double click or a race with the planner cannot
   * apply it twice.
   */
  const statusRoute = (
    path: string,
    move: {
      from: readonly CampaignStatus[]
      to: CampaignStatus
      dispatch: boolean
      action: AuditAction
      precondition?: (campaign: CampaignRow) => Promise<string | null>
      /**
       * Reads the request and stores what the move needs, before it is made.
       * Answers the refusal to send back, or null to go on.
       */
      prepare?: (
        body: unknown,
        campaign: CampaignRow,
      ) => Promise<{ status: number; body: Record<string, unknown> } | null>
    },
  ) => {
    router.post(path, (req, res, next) => {
      void (async () => {
        const id = paramId(req)
        const current = id ? await campaigns.findForUser(id, userId(req)) : null

        if (!current) {
          res.status(404).json({ error: 'Campaign not found' })
          return
        }

        if (
          !move.from.includes(current.status) ||
          !canTransition(current.status, move.to)
        ) {
          res.status(409).json({
            error: `A ${current.status} campaign cannot move to ${move.to}`,
          })
          return
        }

        const blocker = move.precondition ? await move.precondition(current) : null

        if (blocker) {
          // 422: the request is understood and allowed, the campaign is not
          // ready for it.
          res.status(422).json({ error: blocker })
          return
        }

        const refusal = move.prepare ? await move.prepare(req.body, current) : null

        if (refusal) {
          res.status(refusal.status).json(refusal.body)
          return
        }

        const updated = await campaigns.transition(current.id, move.from, move.to)

        if (!updated) {
          res.status(409).json({ error: 'The campaign changed state in the meantime' })
          return
        }

        if (move.dispatch) {
          await dispatchSoon(updated.id)
        }

        // Only a move that happened is recorded; a refused one changed nothing.
        await options.audit?.record(userId(req), move.action, updated.id)

        res.json({ campaign: await withSending(updated) })
      })().catch(next)
    })
  }

  statusRoute('/:id/start', {
    action: 'campaign.started',
    from: ['draft'],
    to: 'scheduled',
    dispatch: true,
    precondition: async (campaign) => {
      if (!campaign.subject?.trim()) {
        return 'The campaign has no subject'
      }
      if (!campaign.body_html?.trim()) {
        return 'The campaign has no body'
      }
      if ((await campaigns.countPendingContacts(campaign.id)) === 0) {
        return 'The campaign has no contact left to send to'
      }
      return null
    },
    /**
     * Now, or at the day and hour the user chose, in the browser's zone, which
     * the campaign takes: the zone is never a setting, it is where the user is.
     */
    prepare: async (body, campaign) => {
      const input = startCampaignSchema.safeParse(body ?? {})

      if (!input.success) {
        return {
          status: 400,
          body: { error: 'Invalid schedule', code: 'invalid_schedule' },
        }
      }

      const timezone = input.data.timezone ?? campaign.timezone
      const sendAfter = input.data.send_after ? new Date(input.data.send_after) : null

      if (sendAfter && !insideSendingWindow(sendAfter, timezone)) {
        return {
          status: 400,
          body: {
            error: 'Sending happens Monday to Saturday, 09:00 to 18:59',
            code: 'outside_send_window',
          },
        }
      }

      await campaigns.update(campaign.id, { timezone, send_after: sendAfter })
      return null
    },
  })

  statusRoute('/:id/pause', {
    action: 'campaign.paused',
    from: ['scheduled', 'running'],
    to: 'paused',
    // Nothing to plan. Jobs already queued find the campaign paused when they
    // try to claim their contact, and do nothing.
    dispatch: false,
  })

  statusRoute('/:id/resume', {
    action: 'campaign.resumed',
    from: ['paused'],
    to: 'running',
    dispatch: true,
  })

  router.delete('/:id', (req, res, next) => {
    void (async () => {
      const id = paramId(req)
      const current = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!current) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      if (!canDelete(current.status)) {
        res.status(409).json({
          error: 'A sending campaign cannot be deleted. Pause it first.',
        })
        return
      }

      await campaigns.remove(current.id)
      res.status(204).end()
    })().catch(next)
  })

  return router
}

/**
 * Why an edit is refused, or null when it is allowed.
 *
 * The state machine decides; this only reports which half of the payload the
 * campaign's state forbids.
 */
function refuseEdit(current: CampaignRow, patch: UpdateCampaignInput): string | null {
  const touchesContent = CONTENT_FIELDS.some((field) => field in patch)
  const touchesCadence = CADENCE_FIELDS.some((field) => field in patch)

  if (touchesContent && !canEditContent(current.status)) {
    return `The subject and body of a ${current.status} campaign can no longer change`
  }

  if (touchesCadence && !canEditCadence(current.status)) {
    return `The pace of a ${current.status} campaign can no longer change`
  }

  return null
}

/** The shape a client sees. user_id stays server-side; it tells a client nothing. */
function toPublicCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    status: row.status,
    totalContacts: row.total_contacts,
    sentCount: row.sent_count,
    errorCount: row.error_count,
    mailsPerDay: row.mails_per_day,
    startHour: row.start_hour,
    pauseMs: row.pause_ms,
    sendAfter: row.send_after?.toISOString() ?? null,
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    scheduledAt: row.scheduled_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}
