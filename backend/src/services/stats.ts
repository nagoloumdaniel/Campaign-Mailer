import type { Pool } from 'pg'

/**
 * The numbers behind a campaign's statistics, read from the rows themselves.
 *
 * Counted rather than taken from the campaign's cached counters: this is the
 * page a user checks when something looks wrong, and it has to show what the
 * database holds, not what it was last told.
 */

export interface ContactCounts {
  total: number
  sent: number
  failed: number
  pending: number
  ignored: number
}

export interface SendWindow {
  /** Sends by this campaign over the last 24 hours. */
  sentLast24h: number
  oldestInWindowAt: Date | null
  lastSentAt: Date | null
}

export interface DaySends {
  /** YYYY-MM-DD, in the campaign's own time zone. */
  day: string
  sent: number
  failed: number
}

export interface StatsRepository {
  contactCounts(campaignId: string): Promise<ContactCounts>
  sendWindow(campaignId: string): Promise<SendWindow>
  sendsPerDay(campaignId: string, timezone: string): Promise<DaySends[]>
  /**
   * What the whole account sent on each of the last `days` calendar days,
   * oldest first, zero-filled, in `timezone`. Feeds the dashboard's sparkline.
   */
  accountSendsPerDay(
    userId: string,
    timezone: string,
    days: number,
  ): Promise<{ day: string; sent: number }[]>
}

export function createStatsRepository(pool: Pool): StatsRepository {
  return {
    async contactCounts(campaignId) {
      const { rows } = await pool.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM contacts
         WHERE campaign_id = $1 GROUP BY status`,
        [campaignId],
      )

      const counts: ContactCounts = {
        total: 0,
        sent: 0,
        failed: 0,
        pending: 0,
        ignored: 0,
      }

      for (const row of rows) {
        counts.total += row.n
        switch (row.status) {
          case 'sent':
            counts.sent = row.n
            break
          case 'failed':
            counts.failed = row.n
            break
          case 'pending':
            counts.pending = row.n
            break
          case 'ignored':
            counts.ignored = row.n
            break
          default:
            break
        }
      }

      return counts
    },

    async sendWindow(campaignId) {
      const { rows } = await pool.query<{
        sent_last_24h: number
        oldest_in_window: Date | null
        last_sent_at: Date | null
      }>(
        `SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int
                  AS sent_last_24h,
                min(created_at) FILTER (WHERE created_at >= now() - interval '24 hours')
                  AS oldest_in_window,
                max(created_at) AS last_sent_at
         FROM logs
         WHERE campaign_id = $1 AND event_type = 'sent'`,
        [campaignId],
      )

      const row = rows[0]

      return {
        sentLast24h: row?.sent_last_24h ?? 0,
        oldestInWindowAt: row?.oldest_in_window ?? null,
        lastSentAt: row?.last_sent_at ?? null,
      }
    },

    async accountSendsPerDay(userId, timezone, days) {
      // The series is generated in SQL so a quiet day is a zero rather than a
      // gap: a sparkline that skips the days nothing was sent draws a steady
      // line through a week of silence. The zone is a bound parameter, and the
      // window a clamped integer, so neither is ever interpolated.
      const span = Math.min(Math.max(Math.trunc(days), 1), 90)

      const { rows } = await pool.query<{ day: string; sent: number }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(s.sent, 0)::int AS sent
         FROM generate_series(
                (now() AT TIME ZONE $2)::date - ($3::int - 1),
                (now() AT TIME ZONE $2)::date,
                interval '1 day'
              ) AS d
         LEFT JOIN (
           SELECT (l.created_at AT TIME ZONE $2)::date AS day, count(*) AS sent
           FROM logs l
           JOIN campaigns c ON c.id = l.campaign_id
           WHERE c.user_id = $1
             AND l.event_type = 'sent'
             AND l.created_at >= now() - ($3::int + 1) * interval '1 day'
           GROUP BY 1
         ) s ON s.day = d::date
         ORDER BY d`,
        [userId, timezone, span],
      )

      return rows
    },

    async sendsPerDay(campaignId, timezone) {
      // Grouped by the day in the campaign's zone: a send at 00:30 in Paris
      // belongs to that morning, not to the UTC day before. The zone is a bound
      // parameter, never interpolated. An error without a contact is a pause
      // reason, not a failed send, so it is not counted.
      const { rows } = await pool.query<DaySends>(
        `SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE event_type = 'sent')::int AS sent,
                count(*) FILTER (WHERE event_type = 'error' AND contact_id IS NOT NULL)::int
                  AS failed
         FROM logs
         WHERE campaign_id = $1
         GROUP BY 1
         HAVING count(*) FILTER (WHERE event_type = 'sent') > 0
             OR count(*) FILTER (WHERE event_type = 'error' AND contact_id IS NOT NULL) > 0
         ORDER BY 1`,
        [campaignId, timezone],
      )

      return rows
    },
  }
}
