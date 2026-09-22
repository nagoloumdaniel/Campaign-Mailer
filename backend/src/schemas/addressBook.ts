import { z } from 'zod'

import { ADDRESS_BOOK_SORTS } from '../services/addressBook.js'

import { ianaTimezone } from './campaign.js'

export const addressBookQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(['pending', 'sent', 'failed', 'ignored']).optional(),
    source: z.enum(['csv', 'manual', 'mailfind']).optional(),
    campaign_id: z.uuid().optional(),
    // A query string carries text: "true" is the only value that means yes.
    unique: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    exclude_campaign_id: z.uuid().optional(),
    sort: z.enum(ADDRESS_BOOK_SORTS).default('company'),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()

/**
 * The export takes the same filters and sort as the list, without the page:
 * it is every contact the filters match. The zone only prints the dates.
 */
export const addressBookExportSchema = addressBookQuerySchema
  .omit({ limit: true, offset: true })
  .extend({ timezone: ianaTimezone.default('Europe/Paris') })
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

/**
 * Contacts already in the account, copied into a draft. The cap is the import
 * batch limit, as for a follow-up.
 */
export const copyToCampaignSchema = z
  .object({
    campaign_id: z.uuid(),
    contact_ids: z.array(z.uuid()).min(1).max(2000),
  })
  .strict()

export type CopyToCampaignInput = z.infer<typeof copyToCampaignSchema>

/** Every field sent, as the edit form holds them all: an absent one is cleared. */
export const updateAddressBookContactSchema = z.object(details).strict()

export type AddressBookQueryInput = z.infer<typeof addressBookQuerySchema>
export type CreateAddressBookContactInput = z.infer<typeof createAddressBookContactSchema>
export type UpdateAddressBookContactInput = z.infer<typeof updateAddressBookContactSchema>
