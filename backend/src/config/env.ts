/**
 * Typed access to the environment, read once at startup.
 *
 * The process refuses to boot when a required variable is missing, so a
 * misconfigured deployment fails immediately and loudly instead of failing
 * later on the first request that needs the value.
 *
 * Variables are added here as the phases that need them land: the database
 * and Redis URLs, the Google OAuth credentials, the session secret and the
 * encryption key. See backend/.env.example.
 */

type NodeEnv = 'development' | 'test' | 'production'

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production']

function required(name: string): string {
  // The name is a literal from this module, never a value from a request.
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name]

  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function optionalInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  // The name is a literal from this module.
  // eslint-disable-next-line security/detect-object-injection
  const raw = process.env[name]

  if (raw === undefined || raw === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `${name} must be an integer between ${String(min)} and ${String(max)}, got: ${raw}`,
    )
  }

  return parsed
}

function nodeEnv(): NodeEnv {
  const raw = process.env.NODE_ENV ?? 'development'

  if (!NODE_ENVS.includes(raw as NodeEnv)) {
    throw new Error(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}, got: ${raw}`)
  }

  return raw as NodeEnv
}

function ssoSecret(): string {
  const value = process.env.MAILFIND_SSO_SECRET ?? ''

  // A short shared secret is one an attacker can grind through the token
  // endpoint; refusing to boot beats running with it.
  if (value !== '' && value.length < 32) {
    throw new Error('MAILFIND_SSO_SECRET must be at least 32 characters')
  }

  return value
}

export const env = {
  nodeEnv: nodeEnv(),
  port: optionalInteger('PORT', 3000, 1, 65535),
  // Proxies in front of the API whose X-Forwarded-For entries are trusted: 1
  // behind Railway alone, 2 when Vercel relays /api to Railway. Too low, and
  // every anonymous visitor shares the proxy's address in the rate limit; too
  // high, and a client can forge its own.
  trustProxyHops: optionalInteger('TRUST_PROXY_HOPS', 1, 0, 5),
  // Protects the Google tokens at rest. Required rather than optional: a
  // process that starts without it would store readable refresh tokens.
  encryptionKey: required('ENCRYPTION_KEY'),

  // Keys retired by a rotation, comma separated. They decrypt and never
  // encrypt, and are removed once the rotation script has run. Empty outside a
  // rotation. See docs/security.md.
  previousEncryptionKeys: (process.env.ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== ''),

  // The pooled Neon host. Migrations use DATABASE_DIRECT_URL instead.
  databaseUrl: required('DATABASE_URL'),

  redisUrl: required('REDIS_URL'),

  // Signs the session cookie. Rotating it signs everyone out.
  sessionSecret: required('SESSION_SECRET'),

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  // Messages one account may send over a rolling 24 hours, across every
  // campaign. Google allows a personal account 500 (support.google.com/mail/
  // answer/22839); 450 leaves room for what the user sends by hand from the
  // same mailbox. Never above 500: past it Google blocks the account for up to
  // a day, and no setting here can undo that.
  gmailDailyLimit: optionalInteger('GMAIL_DAILY_LIMIT', 450, 1, 500),

  storage: {
    endpoint: required('S3_ENDPOINT'),
    // R2 has no regions of its own; its S3 clients want the literal "auto".
    region: process.env.S3_REGION ?? 'auto',
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },

  // Whether the API watches the worker and the queue (services/alerts.ts). On
  // in production; off elsewhere, where the worker is usually not running and
  // would read as stopped.
  monitorWorker:
    (process.env.WORKER_MONITOR ?? (nodeEnv() === 'production' ? 'true' : 'false')) ===
    'true',

  // Error reporting stays off when empty. See services/errorReporting.ts.
  sentryDsn: process.env.SENTRY_DSN ?? '',
  // Tags each error with the deployed commit; Railway sets it on every deploy.
  release: process.env.RAILWAY_GIT_COMMIT_SHA,

  // Sign in with MailFind, and MailFind signing in with this application:
  // MailFind's address and the secret both sides share to trade sign-in codes.
  // Empty, both buttons stay inert. See services/sso.ts.
  mailfind: {
    url: (process.env.MAILFIND_URL ?? '').replace(/\/+$/, ''),
    ssoSecret: ssoSecret(),
  },

  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    // Must match a registered redirect URI character for character, or Google
    // answers redirect_uri_mismatch. See docs/google-oauth-setup.md.
    callbackUrl: required('GOOGLE_CALLBACK_URL'),
  },
} as const

export const isProduction = env.nodeEnv === 'production'

export { required }
