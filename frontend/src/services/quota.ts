import { isActive, remainingOf, type Campaign } from './campaigns'

/**
 * Sharing one daily allowance between several live campaigns.
 *
 * The account has a single ceiling over a rolling 24 hours — 450 messages,
 * below Gmail's own 500 — and every campaign spends from it. Nothing stops a
 * user from setting three campaigns to 200 a day each: the send engine will
 * simply serve them in the order it planned them and the third will sit at
 * zero all day, looking broken. That is the situation this computes a way out
 * of, and it is the reason the pace stays editable while a campaign runs.
 *
 * Pure, and kept out of the component, so the arithmetic can be read on its
 * own — and so the two properties that matter can be checked by eye: the
 * shares always sum to exactly the allowance, and no campaign is ever left at
 * zero while it still has contacts waiting.
 */

export interface QuotaShare {
  campaign: Campaign
  /** What it asks for today. */
  current: number
  /** What it would get. */
  suggested: number
}

export interface QuotaAdvice {
  /** The account's ceiling over 24 hours. */
  limit: number
  /** The sum of every live campaign's daily pace. */
  requested: number
  shares: QuotaShare[]
}

/**
 * The campaigns that actually spend the allowance: scheduled, running or
 * paused, and with something left to send. A paused campaign counts because
 * resuming it is one click, and a plan that ignores it is wrong the moment it
 * is followed.
 */
export function campaignsSharingQuota(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns.filter(
    (campaign) => isActive(campaign.status) && remainingOf(campaign) > 0,
  )
}

/**
 * A fair split of `limit` between the campaigns, or null when there is
 * nothing to fix.
 *
 * Fair here means proportional to what each campaign has left to send, not
 * equal: a campaign with 400 contacts left and one with 12 do not have the
 * same claim on the day, and splitting the allowance down the middle would
 * leave the small one finished by Tuesday and the large one still running in
 * three weeks.
 *
 * Two rules bend that proportion, in this order:
 *
 *   * nobody gets 0. A campaign set to zero would sit at "running, nothing
 *     sent" forever, which is the failure mode the whole advice exists to
 *     avoid. So every campaign gets at least one.
 *   * nobody gets more than it can use. A campaign with 12 contacts left is
 *     capped at 12, and what that frees goes back to the others rather than
 *     being lost.
 *
 * The rounding uses the largest remainder, so the shares sum to exactly the
 * allowance instead of to 448 or 452.
 */
export function suggestShares(
  campaigns: readonly Campaign[],
  limit: number,
): QuotaShare[] {
  if (campaigns.length === 0 || limit <= 0) {
    return []
  }

  // More campaigns than the allowance: there is no split that gives each one
  // a whole message, so the advice is not the place to invent one.
  if (campaigns.length > limit) {
    return []
  }

  const needs = campaigns.map((campaign) => remainingOf(campaign))
  const totalNeed = needs.reduce((sum, need) => sum + need, 0)

  if (totalNeed === 0) {
    return []
  }

  const exact = needs.map((need) => (need / totalNeed) * limit)
  const shares = exact.map((value) => Math.max(1, Math.floor(value)))

  /** Adds `delta` where it helps most, one message at a time. */
  const distribute = (delta: number) => {
    if (delta === 0) {
      return
    }

    // Largest remainder first when handing out, smallest share first when
    // taking back: both leave the split as close to the exact proportion as
    // whole numbers allow.
    const order = shares
      .map((share, index) => ({ index, remainder: (exact.at(index) ?? 0) - share }))
      .sort((a, b) => (delta > 0 ? b.remainder - a.remainder : a.remainder - b.remainder))

    let left = Math.abs(delta)
    let pass = 0

    // Several passes: a campaign capped at what it has left cannot absorb its
    // turn, and the message has to go to somebody.
    while (left > 0 && pass < shares.length + 2) {
      for (const { index } of order) {
        if (left === 0) {
          break
        }

        const share = shares.at(index) ?? 0
        const need = needs.at(index) ?? 0

        if (delta > 0 && share < need) {
          shares[index] = share + 1
          left -= 1
        } else if (delta < 0 && share > 1) {
          shares[index] = share - 1
          left -= 1
        }
      }

      pass += 1
    }
  }

  // Cap each share at what the campaign can actually use, then hand out or
  // take back whatever that leaves.
  for (const [index, need] of needs.entries()) {
    shares[index] = Math.min(shares.at(index) ?? 1, Math.max(1, need))
  }

  distribute(limit - shares.reduce((sum, share) => sum + share, 0))

  return campaigns.map((campaign, index) => ({
    campaign,
    current: campaign.mailsPerDay,
    suggested: shares.at(index) ?? 1,
  }))
}

/**
 * The advice, or null when the campaigns already fit inside the allowance.
 *
 * Silence is the right answer most of the time: a panel that appears on every
 * dashboard teaches the eye to skip the spot where a real warning would be.
 */
export function quotaAdvice(
  campaigns: readonly Campaign[],
  limit: number,
): QuotaAdvice | null {
  const sharing = campaignsSharingQuota(campaigns)

  if (sharing.length < 2) {
    return null
  }

  const requested = sharing.reduce((sum, campaign) => sum + campaign.mailsPerDay, 0)

  if (requested <= limit) {
    return null
  }

  const shares = suggestShares(sharing, limit)

  // Nothing worth proposing: every share would land where it already is.
  if (shares.length === 0 || shares.every((share) => share.suggested === share.current)) {
    return null
  }

  return { limit, requested, shares }
}

/**
 * How full the allowance is, as a tone.
 *
 * Four steps rather than a gradient, because the reader is not measuring a
 * percentage, they are deciding whether to do something about it: nothing to
 * see, getting there, nearly out, out.
 */
export type QuotaLevel = 'calm' | 'moderate' | 'high' | 'full'

export function quotaLevel(used: number, limit: number): QuotaLevel {
  if (limit <= 0) {
    return 'calm'
  }

  const share = used / limit

  if (share >= 1) {
    return 'full'
  }
  if (share >= 0.85) {
    return 'high'
  }
  if (share >= 0.6) {
    return 'moderate'
  }

  return 'calm'
}

export const QUOTA_TONE = {
  calm: 'success',
  moderate: 'info',
  high: 'warning',
  full: 'danger',
} as const
