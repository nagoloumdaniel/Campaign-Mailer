import { z } from 'zod'

import { CAMPAIGN_TYPES } from './campaign.js'
import { IMPORT_BATCH_LIMIT } from './contact.js'

/**
 * The v1 API, as MailFind calls it (roadmap, Phase 9).
 *
 * The same four fields and the same limit as a CSV import: the rules that
 * decide what reaches a mailbox are the import's, whichever door the rows came
 * through.
 */
export const v1ContactSchema = z
  .object({
    email: z.string().max(400),
    contact_name: z.string().max(400).optional(),
    company_name: z.string().max(400).optional(),
    salutation: z.string().max(400).optional(),
  })
  .strict()

const contacts = z.array(v1ContactSchema).max(IMPORT_BATCH_LIMIT)

export const v1CreateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(CAMPAIGN_TYPES).optional(),
    contacts: contacts.default([]),
  })
  .strict()

export const v1AddContactsSchema = z.object({ contacts: contacts.min(1) }).strict()

export type V1CreateCampaignInput = z.infer<typeof v1CreateCampaignSchema>
export type V1AddContactsInput = z.infer<typeof v1AddContactsSchema>
