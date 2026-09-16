import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CAMPAIGN_STATUSES,
  InvalidTransitionError,
  assertTransition,
  canDelete,
  canEditCadence,
  canEditContent,
  canTransition,
  type CampaignStatus,
} from './campaignState.js'

/** Every ordered pair of statuses, so nothing is left unconsidered. */
function allPairs(): [CampaignStatus, CampaignStatus][] {
  return CAMPAIGN_STATUSES.flatMap((from) =>
    CAMPAIGN_STATUSES.map((to) => [from, to] as [CampaignStatus, CampaignStatus]),
  )
}

describe('canTransition', () => {
  const allowed: [CampaignStatus, CampaignStatus][] = [
    ['draft', 'scheduled'],
    ['scheduled', 'draft'],
    ['scheduled', 'running'],
    ['scheduled', 'paused'],
    ['running', 'paused'],
    ['running', 'completed'],
    ['paused', 'running'],
  ]

  for (const [from, to] of allowed) {
    it(`allows ${from} to ${to}`, () => {
      assert.equal(canTransition(from, to), true)
    })
  }

  it('allows nothing else', () => {
    const unexpected = allPairs().filter(
      ([from, to]) =>
        canTransition(from, to) && !allowed.some(([a, b]) => a === from && b === to),
    )

    assert.deepEqual(unexpected, [])
  })

  it('refuses a transition to itself', () => {
    // A no-op transition usually means a duplicated request. Rejecting it
    // makes the duplicate visible instead of silently accepted.
    for (const status of CAMPAIGN_STATUSES) {
      assert.equal(canTransition(status, status), false, status)
    }
  })

  it('treats completed as terminal', () => {
    for (const to of CAMPAIGN_STATUSES) {
      assert.equal(canTransition('completed', to), false, `completed to ${to}`)
    }
  })

  it('never goes back to draft once anything has been sent', () => {
    // draft is editable. Returning there from running or paused would let the
    // body change between two halves of the same campaign, so half the
    // recipients get one message and half another.
    assert.equal(canTransition('running', 'draft'), false)
    assert.equal(canTransition('paused', 'draft'), false)
  })
})

describe('assertTransition', () => {
  it('passes an allowed transition', () => {
    assert.doesNotThrow(() => {
      assertTransition('draft', 'scheduled')
    })
  })

  it('raises an error carrying 409', () => {
    // A refused transition is a conflict with the current state, not a bad
    // request: the payload was fine, the campaign had moved on.
    try {
      assertTransition('completed', 'running')
      assert.fail('expected a throw')
    } catch (err) {
      assert.ok(err instanceof InvalidTransitionError)
      assert.equal(err.status, 409)
      assert.match(err.message, /completed/)
      assert.match(err.message, /running/)
    }
  })
})

describe('canEditContent', () => {
  it('allows editing a draft', () => {
    assert.equal(canEditContent('draft'), true)
  })

  it('refuses every other state', () => {
    // Once a campaign is scheduled, the first send can happen at any moment.
    // Changing the subject or the body after that splits one campaign into
    // two different messages with no record of which went where.
    for (const status of CAMPAIGN_STATUSES.filter((s) => s !== 'draft')) {
      assert.equal(canEditContent(status), false, status)
    }
  })
})

describe('canEditCadence', () => {
  it('allows every state a campaign can still send from', () => {
    for (const status of ['draft', 'scheduled', 'paused', 'running'] as const) {
      assert.equal(canEditCadence(status), true, status)
    }
  })

  it('allows a running campaign, so one allowance can be shared between several', () => {
    // The planner re-reads the pace on every pass and the account ceiling is
    // checked against the logs, not against the plan, so raising it here
    // cannot push the account past its 24-hour limit.
    assert.equal(canEditCadence('running'), true)
  })

  it('refuses a completed campaign', () => {
    assert.equal(canEditCadence('completed'), false)
  })
})

describe('canDelete', () => {
  it('refuses to delete a campaign that is sending', () => {
    // Deleting mid-send cascades the contacts away while jobs still reference
    // them, and loses the record of what was already sent.
    assert.equal(canDelete('running'), false)
  })

  it('allows the other states', () => {
    for (const status of ['draft', 'scheduled', 'paused', 'completed'] as const) {
      assert.equal(canDelete(status), true, status)
    }
  })
})
