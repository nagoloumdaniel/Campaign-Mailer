import { z } from 'zod'

import { ADDRESS_BOOK_SORTS } from '../services/addressBook.js'

export const addressBookQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(['pending', 'sent', 'failed', 'ignored']).optional(),
    source: z.enum(['csv', 'manual', 'mailfind']).optional(),
    campaign_id: z.uuid().optional(),
    sort: z.enum(ADDRESS_BOOK_SORTS).default('company'),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()

/** Same lengths as adding a contact to a campaign (schemas/contact.ts). */
const details = {
  email: z.string().max(400),
  contact_name: z.string().max(200).optional(),
  company_name: z.string().max(200).optional(),
  salutation: z.string().max(100).optional(),
}

export const createAddressBookContactSchema = z
  .object({ campaign_id: z.uuid(), ...details })
  .strict()

/** Every field sent, as the edit form holds them all: an absent one is cleared. */
export const updateAddressBookContactSchema = z.object(details).strict()

export type AddressBookQueryInput = z.infer<typeof addressBookQuerySchema>
export type CreateAddressBookContactInput = z.infer<typeof createAddressBookContactSchema>
export type UpdateAddressBookContactInput = z.infer<typeof updateAddressBookContactSchema>
