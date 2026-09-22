import { Router, type Response } from 'express'

import { isUuid, requireAuth, signedInUserId } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  addressBookQuerySchema,
  createAddressBookContactSchema,
  updateAddressBookContactSchema,
  type CreateAddressBookContactInput,
  type UpdateAddressBookContactInput,
} from '../schemas/addressBook.js'
import type {
  AddressBookRepository,
  AddressBookRow,
  ContactDetails,
  WriteOutcome,
} from '../services/addressBook.js'
import { normaliseEmail } from '../services/contactImport.js'

/**
 * /api/contacts — the account's address book (services/addressBook.ts).
 *
 * The same contacts as under /api/campaigns/:id/contacts, seen across every
 * campaign at once, searchable and sortable, and editable under the same rule:
 * only while their campaign is a draft.
 */
export function createAddressBookRouter({
  addressBook,
}: {
  addressBook: AddressBookRepository
}): Router {
  const router = Router()

  router.use(requireAuth)

  router.get('/', (req, res, next) => {
    void (async () => {
      const query = addressBookQuerySchema.safeParse(req.query)

      if (!query.success) {
        res.status(400).json({ error: 'Invalid query' })
        return
      }

      const { campaign_id: campaignId, ...rest } = query.data
      const { contacts, total } = await addressBook.list(signedInUserId(req), {
        ...rest,
        campaignId,
      })

      res.json({
        contacts: contacts.map(toPublic),
        total,
        limit: query.data.limit,
        offset: query.data.offset,
      })
    })().catch(next)
  })

  router.post('/', validateBody(createAddressBookContactSchema), (req, res, next) => {
    void (async () => {
      const input = req.body as CreateAddressBookContactInput
      const details = detailsOf(input)

      if (!details) {
        invalidEmail(res)
        return
      }

      const outcome = await addressBook.add(
        signedInUserId(req),
        input.campaign_id,
        details,
      )
      answer(res, outcome, 201, 'Campaign not found')
    })().catch(next)
  })

  router.patch(
    '/:contactId',
    validateBody(updateAddressBookContactSchema),
    (req, res, next) => {
      void (async () => {
        const raw: unknown = req.params.contactId

        if (!isUuid(raw)) {
          res.status(404).json({ error: 'Contact not found' })
          return
        }

        const details = detailsOf(req.body as UpdateAddressBookContactInput)

        if (!details) {
          invalidEmail(res)
          return
        }

        answer(
          res,
          await addressBook.update(signedInUserId(req), raw, details),
          200,
          'Contact not found',
        )
      })().catch(next)
    },
  )

  router.delete('/:contactId', (req, res, next) => {
    void (async () => {
      const raw: unknown = req.params.contactId

      if (!isUuid(raw) || !(await addressBook.remove(signedInUserId(req), raw))) {
        res.status(404).json({ error: 'Contact not found' })
        return
      }

      res.status(204).end()
    })().catch(next)
  })

  return router
}

/** The fields as stored: the address normalised, blanks as null. Null when the address is not one. */
function detailsOf(input: UpdateAddressBookContactInput): ContactDetails | null {
  const email = normaliseEmail(input.email)

  return email
    ? {
        email,
        contact_name: blankToNull(input.contact_name),
        company_name: blankToNull(input.company_name),
        salutation: blankToNull(input.salutation),
      }
    : null
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function invalidEmail(res: Response) {
  res.status(400).json({
    error: 'Invalid request',
    code: 'invalid_email',
    details: [{ field: 'email', message: 'Not a valid address' }],
  })
}

/** Each refusal carries a code, so the client never matches on English prose. */
function answer(res: Response, outcome: WriteOutcome, status: number, missing: string) {
  switch (outcome.kind) {
    case 'saved':
      res.status(status).json({ contact: toPublic(outcome.contact) })
      return
    case 'not_found':
      res.status(404).json({ error: missing })
      return
    case 'not_editable':
      res.status(409).json({
        error: 'The campaign has been launched: its contacts can no longer be changed',
        code: 'campaign_not_editable',
      })
      return
    case 'duplicate':
      res.status(409).json({
        error: 'This address is already in the campaign',
        code: 'duplicate_email',
      })
      return
  }
}

function toPublic(row: AddressBookRow) {
  return {
    id: row.id,
    email: row.email,
    contactName: row.contact_name,
    companyName: row.company_name,
    salutation: row.salutation,
    status: row.status,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null,
    campaign: {
      id: row.campaign_id,
      name: row.campaign_name,
      status: row.campaign_status,
      type: row.campaign_type,
    },
  }
}
