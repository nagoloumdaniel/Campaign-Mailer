import { z } from 'zod'

import { CAMPAIGN_TYPES } from './campaign.js'

/**
 * The history's query string.
 *
 * `timezone` only decides how the exported dates are printed, so it is checked
 * for shape and handed to Intl, which refuses an unknown name on its own. A
 * bad value there is a wrong-looking column, never a wrong row.
 */
const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    },
    { message: 'Unknown time zone' },
  )

export const historyQuerySchema = z
  .object({
    search: z.string().max(200).optional(),
    type: z.enum(CAMPAIGN_TYPES).optional(),
    campaign_id: z.uuid().optional(),
    outcome: z.enum(['sent', 'failed']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    timezone: timezone.default('Europe/Paris'),
  })
  .strict()
  // The repository reads `campaignId`; the query string spells it with an
  // underscore like every other parameter of this API.
  .transform((value) => ({
    ...value,
    campaignId: value.campaign_id,
  }))

export type HistoryQueryInput = z.infer<typeof historyQuerySchema>
