import { z } from 'zod'

import { ADDRESS_BOOK_SORTS } from '../services/addressBook.js'

import { ianaTimezone } from './campaign.js'

export const addressBookQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    source: z.enum(['csv', 'manual', 'mailfind']).optional(),
    exclude_campaign_id: z.uuid().optional(),
    sort: z.enum(ADDRESS_BOOK_SORTS).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()

/**
 * The export takes the same filters and sort as the list, without the page:
 * it is every entry the filters match. The zone only prints the dates.
 */
export const addressBookExportSchema = addressBookQuerySchema
  .omit({ limit: true, offset: true })
  .extend({ timezone: ianaTimezone.default('Europe/Paris') })
  .strict()

/**
 * The four fields of a contact, the same as adding one to a campaign
 * (schemas/contact.ts). Every field is sent, as the form holds them all: an
 * absent one is cleared.
 */
export const addressBookContactSchema = z
  .object({
    email: z.string().max(400),
    contact_name: z.string().max(200).optional(),
    company_name: z.string().max(200).optional(),
    salutation: z.string().max(100).optional(),
  })
  .strict()

/**
 * Entries of the book, copied into a draft as recipients. The cap is the
 * import batch limit, as for a follow-up.
 */
export const copyToCampaignSchema = z
  .object({
    campaign_id: z.uuid(),
    contact_ids: z.array(z.uuid()).min(1).max(2000),
  })
  .strict()

export type AddressBookContactInput = z.infer<typeof addressBookContactSchema>
export type CopyToCampaignInput = z.infer<typeof copyToCampaignSchema>
