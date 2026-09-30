/**
 * Turning rows of a spreadsheet into contacts.
 *
 * The rules here decide what reaches a real mailbox, so they lean towards
 * refusing a row rather than guessing at it: a malformed address costs a
 * bounce and a little sender reputation, and reputation is the one resource
 * this application cannot buy back.
 */

/** Longest an address may be, by the standard. */
const MAX_EMAIL = 254
const MAX_LOCAL = 64

/** Matches the column widths the table declares, so a value never fails on insert. */
const MAX_NAME = 200
const MAX_SALUTATION = 100

export type RejectionReason = 'invalid_email' | 'duplicate_in_file' | 'already_imported'

export interface ImportedContact {
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
  /** The line the user would see in their spreadsheet. */
  line: number
  /**
   * What MailFind knows: where the address was found, and its verification.
   * Absent for a CSV row or a contact typed by hand.
   */
  provenance?: ContactProvenance | undefined
}

export type VerificationStatus =
  'valid' | 'accept_all' | 'risky' | 'unknown' | 'unverified'

export interface ContactProvenance {
  source_url: string | null
  verification_status: VerificationStatus | null
  verified_at: string | null
}

export interface RejectedRow {
  line: number
  /** What was read, so the user can find the row. Never used as an address. */
  email: string
  reason: RejectionReason
}

export interface ImportResult {
  accepted: ImportedContact[]
  rejected: RejectedRow[]
  summary: { read: number; accepted: number; rejected: number }
}

export interface RawRow {
  email?: string | undefined
  contact_name?: string | undefined
  company_name?: string | undefined
  salutation?: string | undefined
  source_url?: string | undefined
  verification_status?: VerificationStatus | undefined
  verified_at?: string | undefined
}

export interface CollectOptions {
  /** Addresses already stored for this campaign, normalised. */
  existing?: Set<string>
  /** Line number of the first row, so the report matches the spreadsheet. */
  firstLine?: number
}

/**
 * Validation, deliberately stricter than the standard allows.
 *
 * A full RFC 5322 address can contain quoted strings, comments and characters
 * no mailing list ever holds; accepting them buys nothing and every attempt at
 * an RFC-complete regular expression is a backtracking hazard. This checks the
 * shape a real address has, with every quantifier bounded.
 */
export function normaliseEmail(raw: string | undefined): string | null {
  if (!raw) {
    return null
  }

  const value = raw.trim().toLowerCase()

  if (value.length === 0 || value.length > MAX_EMAIL) {
    return null
  }

  // Split rather than match, so there is no quantifier spanning the at sign.
  const parts = value.split('@')

  if (parts.length !== 2) {
    return null
  }

  const [local, domain] = parts as [string, string]

  if (local.length === 0 || local.length > MAX_LOCAL || domain.length === 0) {
    return null
  }

  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/.test(local)) {
    return null
  }

  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return null
  }

  const labels = domain.split('.')

  // A domain with no dot is a local hostname, not something a campaign sends to.
  if (labels.length < 2) {
    return null
  }

  for (const label of labels) {
    // Three plain checks rather than the usual hostname expression, which puts
    // two overlapping character classes next to each other and is flagged for
    // backtracking. Same rule, no ambiguity: a label is 1 to 63 permitted
    // characters and does not start or end with a hyphen.
    if (label.length === 0 || label.length > 63) {
      return null
    }

    if (!/^[a-z0-9-]+$/.test(label)) {
      return null
    }

    if (label.startsWith('-') || label.endsWith('-')) {
      return null
    }
  }

  // The last label is the top-level domain: letters only, at least two.
  const tld = labels[labels.length - 1]

  if (!tld || !/^[a-z]{2,24}$/.test(tld)) {
    return null
  }

  return value
}

/**
 * MailFind's provenance fields, when the row carries any. The schema of the v1
 * API has already checked their shape; a CSV row never has them.
 */
function provenanceOf(row: RawRow): ContactProvenance | undefined {
  if (!row.source_url && !row.verification_status && !row.verified_at) {
    return undefined
  }

  return {
    source_url: row.source_url ?? null,
    verification_status: row.verification_status ?? null,
    verified_at: row.verified_at ?? null,
  }
}

function optional(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? ''

  // Truncating loses the tail of a company name. Rejecting the row would lose
  // the contact, which is worse.
  return trimmed === '' ? null : trimmed.slice(0, max)
}

/**
 * Validates and de-duplicates a batch of rows.
 *
 * The first occurrence of an address wins. Later ones are rejected rather than
 * merged: a spreadsheet with the same person twice usually holds two different
 * sets of details, and silently picking one would send a message addressed to
 * the wrong company.
 */
export function collectContacts(
  rows: RawRow[],
  options: CollectOptions = {},
): ImportResult {
  const firstLine = options.firstLine ?? 1
  const existing = options.existing ?? new Set<string>()
  const seen = new Set<string>()

  const accepted: ImportedContact[] = []
  const rejected: RejectedRow[] = []

  rows.forEach((row, index) => {
    const line = firstLine + index
    const raw = row.email?.trim() ?? ''
    const email = normaliseEmail(raw)

    if (!email) {
      rejected.push({ line, email: raw.slice(0, MAX_EMAIL), reason: 'invalid_email' })
      return
    }

    if (existing.has(email)) {
      rejected.push({ line, email, reason: 'already_imported' })
      return
    }

    if (seen.has(email)) {
      rejected.push({ line, email, reason: 'duplicate_in_file' })
      return
    }

    seen.add(email)
    const provenance = provenanceOf(row)
    accepted.push({
      email,
      contact_name: optional(row.contact_name, MAX_NAME),
      company_name: optional(row.company_name, MAX_NAME),
      salutation: optional(row.salutation, MAX_SALUTATION),
      line,
      ...(provenance ? { provenance } : {}),
    })
  })

  return {
    accepted,
    rejected,
    summary: { read: rows.length, accepted: accepted.length, rejected: rejected.length },
  }
}
