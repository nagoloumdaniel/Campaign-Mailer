import { gunzipSync, gzipSync } from 'node:zlib'

import type { Pool, PoolClient } from 'pg'

/**
 * A daily copy of the data, and the way back.
 *
 * Not `pg_dump`: the image the API and the worker run in has no PostgreSQL
 * client binaries, and adding them to pull a file no one has ever restored
 * would be the classic untested backup. This writes what the application
 * itself can read and write, through the connection it already has, so the
 * restore path is exercised by a test on every run (backup.integration.test.ts)
 * rather than trusted.
 *
 * What is copied is the data. The schema comes from the migrations, which are
 * applied before the API starts and are proven from nothing on every test run.
 *
 * Format: one gzipped JSON object per line, `{"table":…,"row":{…}}`, in the
 * order the foreign keys require. A line per row rather than one document, so
 * a large table never has to be held in memory whole when this grows.
 */

/** Parents first: a restore inserts in this order, and empties in reverse. */
export const BACKED_UP_TABLES = [
  'users',
  // Before contacts, whose book_id points at it. A backup written before the
  // address book existed has no such lines: the trigger rebuilds the entries
  // as its contacts are restored.
  'address_book',
  'campaigns',
  'campaign_attachments',
  'contacts',
  'logs',
  'audit_events',
] as const

export type BackedUpTable = (typeof BACKED_UP_TABLES)[number]

/**
 * A pool, or a client whose transaction the caller drives.
 *
 * Given a pool, these functions open their own transaction, which is what the
 * worker wants. Given a client, they join the caller's, which is what lets the
 * test hold the tables for the length of a backup and a restore instead of
 * racing the files running beside it.
 */
export type BackupDb = Pool | PoolClient

function isPool(db: BackupDb): db is Pool {
  // By `release`, not by `connect`: a client taken from a pool has both, and
  // testing for `connect` made this call `client.connect()` on a live one.
  return !('release' in db)
}

export interface BackupSummary {
  key: string
  bytes: number
  rows: Record<BackedUpTable, number>
}

export interface BackupStore {
  put: (key: string, body: Buffer, contentType: string) => Promise<void>
  get: (key: string) => Promise<Buffer>
  list: (prefix: string) => Promise<string[]>
  remove: (key: string) => Promise<void>
}

export const BACKUP_PREFIX = 'backups/'

/** Enough to keep a month of daily copies, and no more. */
export const BACKUPS_KEPT = 30

function backupKey(at: Date): string {
  return `${BACKUP_PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.jsonl.gz`
}

async function readAllRows(client: PoolClient): Promise<{
  lines: string[]
  rows: Record<BackedUpTable, number>
}> {
  const lines: string[] = []
  const rows = {} as Record<BackedUpTable, number>

  for (const table of BACKED_UP_TABLES) {
    // The names come from the constant above, never from a caller.
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${table} ORDER BY created_at, id`,
    )
    // eslint-disable-next-line security/detect-object-injection -- a literal from BACKED_UP_TABLES
    rows[table] = result.rows.length

    for (const row of result.rows) {
      lines.push(JSON.stringify({ table, row }))
    }
  }

  return { lines, rows }
}

export async function createBackup(
  db: BackupDb,
  store: BackupStore,
  now: Date = new Date(),
): Promise<BackupSummary> {
  let read: { lines: string[]; rows: Record<BackedUpTable, number> }

  if (isPool(db)) {
    const client = await db.connect()

    try {
      // One transaction, so the copy is one point in time rather than five.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      read = await readAllRows(client)
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
  } else {
    read = await readAllRows(db)
  }

  const body = gzipSync(Buffer.from(`${read.lines.join('\n')}\n`, 'utf8'))
  const key = backupKey(now)
  await store.put(key, body, 'application/gzip')

  return { key, bytes: body.byteLength, rows: read.rows }
}

/** Deletes the oldest copies beyond `kept`. Keys are dated, so they sort by age. */
export async function pruneBackups(
  store: BackupStore,
  kept: number = BACKUPS_KEPT,
): Promise<string[]> {
  const keys = await store.list(BACKUP_PREFIX)
  const old = keys.slice(0, Math.max(0, keys.length - kept))

  for (const key of old) {
    await store.remove(key)
  }

  return old
}

interface BackupLine {
  table: BackedUpTable
  row: Record<string, unknown>
}

function parseBackup(body: Buffer): BackupLine[] {
  return gunzipSync(body)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as BackupLine)
}

async function insertRow(
  client: PoolClient,
  table: BackedUpTable,
  row: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(row)
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`)

  // The table comes from the file's own `table` field, checked against the
  // constant above before this is called; the column names come from the row.
  await client.query(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${placeholders.join(', ')})`,
    Object.values(row),
  )
}

async function writeAllRows(
  client: PoolClient,
  lines: BackupLine[],
): Promise<Record<BackedUpTable, number>> {
  const restored = Object.fromEntries(
    BACKED_UP_TABLES.map((table) => [table, 0]),
  ) as Record<BackedUpTable, number>

  // Children first, and CASCADE for what the foreign keys carry.
  await client.query(`TRUNCATE ${[...BACKED_UP_TABLES].reverse().join(', ')} CASCADE`)

  for (const table of BACKED_UP_TABLES) {
    for (const line of lines.filter((candidate) => candidate.table === table)) {
      await insertRow(client, table, line.row)
      // eslint-disable-next-line security/detect-object-injection -- a literal from BACKED_UP_TABLES
      restored[table] += 1
    }
  }

  return restored
}

/**
 * Replaces the current data with a backup's, in one transaction: either the
 * whole copy is in place, or nothing changed.
 */
export async function restoreBackup(
  db: BackupDb,
  body: Buffer,
): Promise<Record<BackedUpTable, number>> {
  const lines = parseBackup(body)
  const unknown = lines.find((line) => !BACKED_UP_TABLES.includes(line.table))

  if (unknown) {
    throw new Error(`The backup holds an unknown table: ${unknown.table}`)
  }

  if (!isPool(db)) {
    return writeAllRows(db, lines)
  }

  const client = await db.connect()

  try {
    await client.query('BEGIN')
    const restored = await writeAllRows(client, lines)
    await client.query('COMMIT')
    return restored
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
