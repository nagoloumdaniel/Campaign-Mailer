import { z } from 'zod'

import { ianaTimezone } from './campaign.js'

/**
 * The dashboard's query string.
 *
 * The zone decides which calendar day a send falls on in the account's
 * sparkline, and it is bound into `AT TIME ZONE`, so it goes through the same
 * IANA-only check a campaign's zone does: a fixed offset such as `+02:00` would
 * be accepted by Intl and then read differently by PostgreSQL.
 */
export const dashboardQuerySchema = z
  .object({
    timezone: ianaTimezone.default('Europe/Paris'),
  })
  .strict()
