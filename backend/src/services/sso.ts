import crypto from 'node:crypto'

import type { Request } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'

import { USER_COLUMNS, type UserRow } from './users.js'

/**
 * Sign in with MailFind, both ways (MailFind decision D-26).
 *
 * Each application is the other's identity provider. What crosses is the
 * Google id, the same for a person whatever the OAuth client, and the address.
 * Never a Google token: MailFind promises its users it never touches mail.
 */
export const ssoIdentitySchema = z.object({
  google_id: z.string().min(1).max(255),
  email: z.email().max(320),
  name: z.string().max(200).nullable().optional(),
})
export type SsoIdentity = z.infer<typeof ssoIdentitySchema>

/** A state value as both applications make them. */
export const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/** Holds MailFind's request for the length of a Google sign-in. */
export const PENDING_COOKIE = 'cm.sso'

/** One minute: a redirect and a call, nothing more. */
const CODE_TTL_SECONDS = 60

export interface SsoConfig {
  partnerUrl: string
  secret: string
}

/** The configuration, or null when the feature is off. */
export function ssoConfig(config: { url: string; ssoSecret: string }): SsoConfig | null {
  return config.url === '' || config.ssoSecret === ''
    ? null
    : { partnerUrl: config.url, secret: config.ssoSecret }
}

/** Constant time, over digests so the lengths always match. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

/** Reads one cookie without adding a dependency for it. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie

  if (header === undefined) {
    return undefined
  }

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')

    if (key === name) {
      return decodeURIComponent(rest.join('='))
    }
  }

  return undefined
}

const hash = (code: string) => crypto.createHash('sha256').update(code).digest('hex')

export interface SsoCodeRepository {
  issue(userId: string): Promise<string>
  /** The account behind a live, unused code, or null. Burns the code. */
  consume(code: string): Promise<UserRow | null>
}

export function createSsoCodeRepository(pool: Pool): SsoCodeRepository {
  return {
    async issue(userId) {
      const code = crypto.randomBytes(32).toString('base64url')

      // Housekeeping here keeps the table tiny without another scheduled job.
      await pool.query(
        `DELETE FROM sso_codes WHERE expires_at < now() - interval '1 hour'`,
      )
      await pool.query(
        `INSERT INTO sso_codes (code_hash, user_id, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [hash(code), userId, CODE_TTL_SECONDS],
      )

      return code
    },

    async consume(code) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
        return null
      }

      // One conditional update rather than a read then a write, so two
      // exchanges of the same code can never both succeed.
      const { rows } = await pool.query<UserRow>(
        `WITH burnt AS (
           UPDATE sso_codes SET used_at = now()
            WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
            RETURNING user_id
         )
         SELECT ${USER_COLUMNS} FROM users WHERE id = (SELECT user_id FROM burnt)`,
        [hash(code)],
      )

      return rows[0] ?? null
    },
  }
}

export type SsoExchange = (code: string) => Promise<SsoIdentity>

/**
 * Trades a code MailFind issued for the account's identity. The URL is the
 * operator's configuration, never a user's; no redirect is followed and the
 * call cannot hang.
 */
export function createSsoExchange(config: SsoConfig): SsoExchange {
  return async (code) => {
    const res = await fetch(`${config.partnerUrl}/api/sso/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ code }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      throw new Error(`MailFind refused the code (${String(res.status)})`)
    }

    return ssoIdentitySchema.parse(await res.json())
  }
}
