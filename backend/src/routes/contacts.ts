import { Router, type RequestHandler } from 'express'

import {
  campaignIdParam,
  isUuid,
  requireAuth,
  signedInUserId,
} from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  addContactSchema,
  importContactsSchema,
  listContactsSchema,
  updateContactSchema,
  type AddContactInput,
  type ImportContactsInput,
  type UpdateContactInput,
} from '../schemas/contact.js'
import { canEditContent } from '../services/campaignState.js'
import type { CampaignRepository } from '../services/campaigns.js'
import { collectContacts, normaliseEmail } from '../services/contactImport.js'
import type { ContactRepository, ContactRow } from '../services/contacts.js'

export interface ContactRouterDeps {
  campaigns: CampaignRepository
  contacts: ContactRepository
}

/**
 * Contacts live under a campaign, so every route resolves the campaign for the
 * signed-in user first. A campaign that is not theirs is not found, and the
 * contacts under it are unreachable by construction rather than by a check
 * that could be forgotten on a new route.
 */
export function createContactRouter({ campaigns, contacts }: ContactRouterDeps): Router {
  // mergeParams, or :id from the parent mount is not visible here.
  const router = Router({ mergeParams: true })

  router.use(requireAuth)

  /** Resolves the campaign, or answers 404 and stops. */
  const withCampaign: RequestHandler = (req, res, next) => {
    void (async () => {
      const id = campaignIdParam(req)
      const campaign = id ? await campaigns.findForUser(id, signedInUserId(req)) : null

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      res.locals.campaign = campaign
      next()
    })().catch(next)
  }

  router.use(withCampaign)

  const campaignOf = (res: { locals: Record<string, unknown> }) =>
    res.locals.campaign as { id: string; status: Parameters<typeof canEditContent>[0] }

  router.get('/', (req, res, next) => {
    void (async () => {
      const query = listContactsSchema.safeParse(req.query)

      if (!query.success) {
        res.status(400).json({ error: 'Invalid query' })
        return
      }

      const { contacts: rows, total } = await contacts.list(
        campaignOf(res).id,
        query.data,
      )

      res.json({
        contacts: rows.map(toPublicContact),
        total,
        limit: query.data.limit,
        offset: query.data.offset,
      })
    })().catch(next)
  })

  /**
   * Imports a batch of rows.
   *
   * The rows arrive already mapped to the four fields, because the web app has
   * to parse the file anyway to offer the column mapping and the preview. None
   * of it is trusted: every address is validated and de-duplicated here, and
   * the unique index has the last word.
   */
  router.post('/import', validateBody(importContactsSchema), (req, res, next) => {
    void (async () => {
      const campaign = campaignOf(res)

      if (!canEditContent(campaign.status)) {
        res.status(409).json({
          error:
            'Contacts can no longer be imported once the campaign has been scheduled',
        })
        return
      }

      const input = req.body as ImportContactsInput
      const existing = await contacts.existingEmails(campaign.id)

      const result = collectContacts(input.rows, {
        existing,
        ...(input.first_line === undefined ? {} : { firstLine: input.first_line }),
      })

      const inserted = await contacts.insertMany(campaign.id, result.accepted)

      res.status(201).json({
        report: {
          read: result.summary.read,
          // What the database actually took, not what passed validation. The
          // two differ when a concurrent import claimed an address first.
          imported: inserted,
          rejected: result.rejected,
        },
      })
    })().catch(next)
  })

  router.post('/', validateBody(addContactSchema), (req, res, next) => {
    void (async () => {
      const campaign = campaignOf(res)

      if (!canEditContent(campaign.status)) {
        res.status(409).json({
          error: 'This campaign no longer accepts new contacts',
          code: 'campaign_not_editable',
        })
        return
      }

      const input = req.body as AddContactInput
      const email = normaliseEmail(input.email)

      if (!email) {
        res.status(400).json({
          error: 'Invalid request',
          // The two ways this route can refuse both answer 409 or 400 with a
          // sentence written for a developer. A client showing the person
          // which of them happened would otherwise have to match on English
          // prose, so each carries a code that is part of the contract.
          code: 'invalid_email',
          details: [{ field: 'email', message: 'Not a valid address' }],
        })
        return
      }

      const created = await contacts.add(campaign.id, {
        email,
        contact_name: blankToNull(input.contact_name),
        company_name: blankToNull(input.company_name),
        salutation: blankToNull(input.salutation),
      })

      if (!created) {
        res.status(409).json({
          error: 'This address is already in the campaign',
          code: 'duplicate_email',
        })
        return
      }

      res.status(201).json({ contact: toPublicContact(created) })
    })().catch(next)
  })

  router.patch('/:contactId', validateBody(updateContactSchema), (req, res, next) => {
    void (async () => {
      const raw: unknown = req.params.contactId

      if (!isUuid(raw)) {
        res.status(404).json({ error: 'Contact not found' })
        return
      }

      const patch = req.body as UpdateContactInput
      const updated = await contacts.update(campaignOf(res).id, raw, patch)

      if (!updated) {
        res.status(404).json({ error: 'Contact not found' })
        return
      }

      res.json({ contact: toPublicContact(updated) })
    })().catch(next)
  })

  router.delete('/:contactId', (req, res, next) => {
    void (async () => {
      const raw: unknown = req.params.contactId

      if (!isUuid(raw) || !(await contacts.remove(campaignOf(res).id, raw))) {
        res.status(404).json({ error: 'Contact not found' })
        return
      }

      res.status(204).end()
    })().catch(next)
  })

  return router
}

/**
 * An absent field and a field of spaces mean the same thing here, and both
 * become null. `??` would keep the empty string, which then reads as a name
 * in the table and merges as a blank in the email.
 */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function toPublicContact(row: ContactRow) {
  return {
    id: row.id,
    email: row.email,
    contactName: row.contact_name,
    companyName: row.company_name,
    salutation: row.salutation,
    status: row.status,
    errorMessage: row.error_message,
    attempts: row.attempts,
    sentAt: row.sent_at?.toISOString() ?? null,
  }
}
