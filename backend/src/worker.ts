import { Worker, type Job } from 'bullmq'

import { env } from './config/env.js'
import { closePool, pool } from './db/pool.js'
import {
  CAMPAIGN_QUEUE,
  QUEUE_PREFIX,
  SEND_JOB,
  WAKE_CHANNEL,
  createQueueConnection,
} from './jobs/connection.js'
import { HEARTBEAT_EVERY_MS, writeHeartbeat } from './jobs/heartbeat.js'
import { createIdleController, readQueueActivity } from './jobs/idleSleep.js'
import { nextPlanDelay } from './jobs/planClock.js'
import {
  createDispatchProcessor,
  createSendProcessor,
  failAfterLastAttempt,
} from './jobs/processors.js'
import { createQueues, type CampaignJobData } from './jobs/queues.js'
import { logger } from './logger.js'
import { createBackup, pruneBackups } from './services/backup.js'
import { createComposer } from './services/composer.js'
import type { SendJobData } from './services/dispatch.js'
import { createTokenCipher } from './services/encryption.js'
import {
  closeErrorReporting,
  initErrorReporting,
  reportAlert,
  reportError,
  type ErrorContext,
} from './services/errorReporting.js'
import {
  createAlertTracker,
  readSendCounts,
  runAlertChecks,
  sendErrorRateAlert,
} from './services/alerts.js'
import { createGmailGateway } from './services/gmail.js'
import { purgeExpired } from './services/retention.js'
import {
  deleteObject,
  getAttachment,
  getObject,
  listKeys,
  putObject,
} from './services/storage.js'
import {
  createAccessTokenProvider,
  createGoogleTokenEndpoint,
} from './services/tokenRefresh.js'
import { createUserRepository } from './services/users.js'

/**
 * The worker process: plans campaigns and sends their messages.
 *
 * Separate from the API so a deploy of one does not cut the other mid-flight,
 * and so a burst of sends never competes with a user's request for a
 * connection. It sleeps while nothing is due — see jobs/idleSleep.ts — so it
 * can run around the clock within Upstash's free allowance.
 */

const log = logger.child({ service: 'worker' })

const reporting = initErrorReporting({
  dsn: env.sentryDsn,
  environment: env.nodeEnv,
  release: env.release,
  service: 'worker',
})

/**
 * How often a sleeping worker looks for work, and how far ahead it looks.
 * The horizon is longer than the interval so a job due just after one check is
 * caught by that check rather than the next.
 */
const IDLE_CHECK_EVERY_MS = 2 * 60 * 1000
const IDLE_HORIZON_MS = 2.5 * 60 * 1000

/**
 * A job held by a worker that died is recovered within five minutes instead of
 * BullMQ's default thirty seconds, which saves a stalled-job check every thirty
 * seconds. The contact's claim lasts ten minutes, so nothing is lost by waiting.
 */
const STALLED_INTERVAL_MS = 5 * 60 * 1000

/**
 * The timer for the next plan, and when it fires. Declared before the worker
 * starts: a dispatch job waiting in the queue at startup runs at once and sets
 * them (see planNoLaterThan).
 */
let planTimer: NodeJS.Timeout | undefined
let nextPlanAt = Number.POSITIVE_INFINITY

const connection = createQueueConnection(env.redisUrl)
const queues = createQueues(connection)

const processSend = createSendProcessor({
  pool,
  gateway: createGmailGateway(),
  getAccessToken: createAccessTokenProvider({
    auth: createUserRepository(pool),
    cipher: createTokenCipher(env.encryptionKey, env.previousEncryptionKeys),
    endpoint: createGoogleTokenEndpoint(env.google),
  }),
  compose: createComposer({ pool, readAttachment: getAttachment }),
  dailyLimit: env.gmailDailyLimit,
})

const processDispatch = createDispatchProcessor({
  pool,
  accountLimit: env.gmailDailyLimit,
  enqueueSend: (job, delayMs) => queues.enqueueSend(job, delayMs),
})

function isSendJob(job: Job<CampaignJobData>): job is Job<SendJobData> {
  return job.name === SEND_JOB
}

/**
 * Every line and every reported error about a job carries its id, and the
 * campaign and contact it concerns: what `grep jobId` needs to rebuild one
 * send's story across the attempts.
 */
function jobContext(job: Job<CampaignJobData>): ErrorContext {
  return {
    ...(job.id === undefined ? {} : { jobId: job.id }),
    job: job.name,
    attempt: job.attemptsMade + 1,
    ...(job.data.campaignId ? { campaignId: job.data.campaignId } : {}),
    ...(isSendJob(job) ? { contactId: job.data.contactId, userId: job.data.userId } : {}),
  }
}

function jobLogger(job: Job<CampaignJobData>) {
  return log.child(jobContext(job))
}

const worker = new Worker<CampaignJobData>(
  CAMPAIGN_QUEUE,
  async (job) => {
    const jobLog = jobLogger(job)

    if (isSendJob(job)) {
      const outcome = await processSend(job.data)
      // The outcome kind only: never the address, never the message.
      jobLog.info({ outcome: outcome.kind }, 'Send job finished')

      // Neither throws, so the failed handler below never sees them.
      if (outcome.kind === 'failed') {
        // Usually the recipient, not the code: a warning, grouped into one issue.
        reportError(new Error('Gmail refused the message'), {
          ...jobContext(job),
          service: 'worker',
          level: 'warning',
          reason: outcome.reason,
          fingerprint: ['send-refused'],
        })
      } else if (outcome.kind === 'ambiguous') {
        reportError(
          new Error('Send outcome unknown: contact marked failed, not retried'),
          {
            ...jobContext(job),
            service: 'worker',
            fingerprint: ['send-ambiguous'],
          },
        )
      }
      return
    }

    const outcomes = await processDispatch(job.data)
    jobLog.info({ campaigns: outcomes.size }, 'Dispatch job finished')
    // A campaign launched at 9:50 says "10:00"; the timer must not miss it.
    planNoLaterThan(Date.now() + nextPlanDelay(outcomes.values(), Date.now()))
  },
  // One job at a time. The pace between messages is the point of this
  // product, the planner already spreads the sends out, and a plan is a few
  // queries that never waits long behind a send.
  {
    connection,
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    stalledInterval: STALLED_INTERVAL_MS,
  },
)

worker.on('failed', (job, err) => {
  if (!job) {
    log.error({ err }, 'A job failed without a job attached')
    reportError(err, { service: 'worker' })
    return
  }

  const jobLog = jobLogger(job)
  const lastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1)
  jobLog[lastAttempt ? 'error' : 'warn']({ err, lastAttempt }, 'Job failed')

  // An attempt that will be retried is logged, not reported: Gmail's "not now"
  // is routine, and only running out of attempts needs a person.
  if (lastAttempt) {
    reportError(err, { ...jobContext(job), service: 'worker' })
  }

  if (!lastAttempt || !isSendJob(job)) {
    return
  }

  failAfterLastAttempt(pool, job.data, err).catch((recordErr: unknown) => {
    jobLog.error({ err: recordErr }, 'Could not record a send that ran out of attempts')
  })
})

worker.on('error', (err) => {
  log.error({ err }, 'Worker error')
  reportError(err, { service: 'worker' })
})

const idle = createIdleController({
  worker,
  readActivity: () => readQueueActivity(queues.queue),
  horizonMs: IDLE_HORIZON_MS,
})

function checkIdle(): void {
  idle
    .check()
    .then((decision) => {
      if (decision !== 'stay') {
        log.debug({ decision }, 'Idle check')
      }
    })
    .catch((err: unknown) => {
      // A failed check leaves the worker as it was. Awake costs commands;
      // asleep costs latency; neither loses a send, and the next check tries
      // again.
      log.warn({ err }, 'Idle check failed')
    })
}

const alertTracker = createAlertTracker()

/**
 * The send error rate alert. Called after each plan, which has just woken the
 * database, so Neon is never woken for this alone.
 */
function checkSendErrorRate(): void {
  runAlertChecks({
    watched: ['send_error_rate'],
    checks: async () => [sendErrorRateAlert(await readSendCounts(pool))],
    tracker: alertTracker,
    log,
    report: reportAlert,
  }).catch((err: unknown) => {
    log.warn({ err }, 'Send error rate check failed')
  })
}

/**
 * Plans every campaign from this process rather than from a repeatable job.
 *
 * A job scheduler lives in Redis, so it would wake the sleeping worker every
 * fifteen minutes just to run a plan that usually finds nothing. Called here,
 * the plan only touches Redis when it queues a send, and the check that follows
 * wakes the worker for exactly that case.
 */
function planAll(): void {
  processDispatch({})
    .then((outcomes) => {
      planNoLaterThan(Date.now() + nextPlanDelay(outcomes.values(), Date.now()), true)
      checkIdle()
      checkSendErrorRate()
    })
    .catch((err: unknown) => {
      log.error({ err }, 'Scheduled dispatch failed')
      reportError(err, { service: 'worker', job: 'dispatch' })
      planNoLaterThan(Date.now() + nextPlanDelay([], Date.now()), true)
    })
}

/**
 * One timer for the next plan, set to the earliest instant any campaign asked
 * for (jobs/planClock.ts). `replace` is for the plan that just ran: its answer
 * stands even when it is later than the one it consumed.
 */
function planNoLaterThan(at: number, replace = false): void {
  if (!replace && at >= nextPlanAt) {
    return
  }

  clearTimeout(planTimer)
  nextPlanAt = at
  planTimer = setTimeout(
    () => {
      nextPlanAt = Number.POSITIVE_INFINITY
      planAll()
    },
    Math.max(0, at - Date.now()),
  )
}

// Earlier versions scheduled the plan as a repeatable job. Left in Redis, it
// would keep waking the worker; removing a scheduler that is not there is a
// no-op.
await queues.queue.removeJobScheduler('dispatch-all')

const idleTimer = setInterval(checkIdle, IDLE_CHECK_EVERY_MS)
planAll()

/**
 * Woken by the API when a user starts or resumes a campaign, so its first
 * message does not wait for the next idle check (jobs/connection.ts). A
 * connection in subscriber mode can run nothing else, hence its own.
 */
const wakeListener = connection.duplicate()
wakeListener.on('error', (err: Error) => {
  log.warn({ err }, 'Wake channel connection error')
})
wakeListener.on('message', () => {
  checkIdle()
})
await wakeListener.subscribe(WAKE_CHANNEL).catch((err: unknown) => {
  // Without it a launch waits for the two-minute check, as it used to.
  log.warn({ err }, 'Could not listen for wake calls')
})

/**
 * Once a day, send logs and audit events past twelve months are deleted
 * (services/retention.ts). Run from the worker because it is the process that
 * is always there; a missed day only means the purge takes two days' worth.
 */
const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000

function purgeOld(): void {
  purgeExpired(pool)
    .then((report) => {
      if (report.logs + report.auditEvents > 0) {
        log.info(report, 'Retention purge')
      }
    })
    .catch((err: unknown) => {
      log.error({ err }, 'Retention purge failed')
      reportError(err, { service: 'worker', job: 'retention' })
    })
}

const retentionTimer = setInterval(purgeOld, RETENTION_EVERY_MS)
purgeOld()

/**
 * Once a day, a copy of the data to the bucket, and the copies older than a
 * month deleted (services/backup.ts). Run from the worker, the process that is
 * always there; a missed day costs a day of history, not the backup.
 */
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000

const backupStore = {
  put: putObject,
  get: getObject,
  list: listKeys,
  remove: deleteObject,
}

function backUp(): void {
  createBackup(pool, backupStore)
    .then(async (summary) => {
      log.info(
        { key: summary.key, bytes: summary.bytes, rows: summary.rows },
        'Backup written',
      )
      const pruned = await pruneBackups(backupStore)
      if (pruned.length > 0) {
        log.info({ deleted: pruned.length }, 'Old backups deleted')
      }
    })
    .catch((err: unknown) => {
      log.error({ err }, 'Backup failed')
      reportError(err, { service: 'worker', job: 'backup' })
    })
}

const backupTimer = setInterval(backUp, BACKUP_EVERY_MS)
backUp()

/** The sign of life the API's readiness report and the alerts read (jobs/heartbeat.ts). */
function beat(): void {
  writeHeartbeat(connection).catch((err: unknown) => {
    log.warn({ err }, 'Heartbeat could not be written')
  })
}

const heartbeatTimer = setInterval(beat, HEARTBEAT_EVERY_MS)
beat()

log.info({ env: env.nodeEnv, errorReporting: reporting }, 'Worker started')

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy. `close()` waits for
 * the job in hand, and a send cut between Gmail's answer and its record is the
 * one outcome this engine can only report as unknown.
 */
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Finishing the job in hand')

  clearTimeout(planTimer)
  clearInterval(idleTimer)
  clearInterval(retentionTimer)
  clearInterval(heartbeatTimer)
  clearInterval(backupTimer)

  setTimeout(() => {
    log.error('Forced exit after shutdown timeout')
    process.exit(1)
  }, 30_000).unref()

  await worker.close()
  await Promise.allSettled([queues.close(), closePool(), closeErrorReporting()])
  await wakeListener.quit().catch(() => undefined)
  await connection.quit().catch(() => undefined)

  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
