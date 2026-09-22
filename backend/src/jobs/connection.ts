import { Redis } from 'ioredis'

import { logger } from '../logger.js'

/**
 * The Redis connection BullMQ runs on.
 *
 * ioredis, not the node-redis client the session store uses. BullMQ 6 ships a
 * node-redis adapter, and it was tried first against Upstash: the adapter holds
 * a duplicated client's `ready` until `CLIENT SETNAME` answers, Upstash does not
 * honour it, so the worker's blocking connection never became ready and delayed
 * jobs were never picked up. The same test over ioredis processed a two-second
 * delayed job at 2.2 s and closed cleanly.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own requirement: without it a
 * blocking command gives up after the default retries instead of waiting.
 */
export function createQueueConnection(url: string): Redis {
  const connection = new Redis(url, { maxRetriesPerRequest: null })

  connection.on('error', (err: Error) => {
    // ioredis reconnects on its own; the log keeps a recurring failure visible.
    logger.warn({ err }, 'Queue Redis connection error')
  })

  return connection
}

/** Namespaces every BullMQ key, so the queue never collides with sessions. */
export const QUEUE_PREFIX = 'cm'

/**
 * One queue, two kinds of job.
 *
 * Two queues cost two workers, and an idle BullMQ worker is not free on
 * Upstash, where every command counts against 500 000 a month: measured on
 * 14 September 2026, two idle workers spent 14 commands a minute, about
 * 605 000 a month. BullMQ blocks for at most ten seconds whatever `drainDelay`
 * says, so the only lever is the number of workers.
 */
export const CAMPAIGN_QUEUE = 'campaign'

/** Plans one campaign, or every scheduled and running one when no id is given. */
export const DISPATCH_JOB = 'dispatch'

/** Sends one contact its message. */
export const SEND_JOB = 'send'

/**
 * The channel the API rings when a user starts or resumes a campaign.
 *
 * The worker sleeps while nothing is due (idleSleep.ts) and looks again every
 * two minutes. A campaign launched at 11:00 would otherwise wait up to that long
 * for its first message. A subscribed connection costs no command while it
 * waits, so the ring is one PUBLISH per launch; if it is ever lost, the
 * two-minute check still catches the job.
 */
export const WAKE_CHANNEL = 'cm:wake'

/** BullMQ refuses a custom job id containing a colon. */
export function sendJobId(contactId: string): string {
  return `send-${contactId}`
}
