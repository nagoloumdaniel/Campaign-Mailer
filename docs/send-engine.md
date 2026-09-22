# The send engine

How a campaign becomes messages, and what happens when something goes wrong.

This is the part of the codebase where a defect is not recoverable. A duplicate
email reaches a real person and cannot be unsent; an over-aggressive run gets a
user's Google account suspended. Everything below is written for those two
failures, not for the happy path.

---

## The shape

One BullMQ queue, `campaign`, with two kinds of job, run by one worker.

**`dispatch`** runs on a schedule and on demand. For every scheduled or running
campaign it works out how many messages may go out today, takes that many
`pending` contacts, and schedules one send job for each.

**`send`** carries one job per contact. A job claims its contact, asks Gmail to
send, and records the outcome.

One queue rather than two because each queue needs a worker, and an idle worker
polls Redis: a blocking call of at most ten seconds and a script, every cycle.
On Upstash's free tier, where every command counts against 500 000 a month,
two idle workers measured 14 commands a minute (about 605 000 a month) and one
measured 12 (about 518 000). One queue helps; it does not, alone, bring an
always-on worker under the allowance.

What does is sleep. The worker pauses whenever nothing is waiting, nothing is
running and no delayed job falls due within two and a half minutes, and a check
every two minutes wakes it. Asleep it measured 1 command a minute, about 43 000
a month; a job queued while it slept started 89 seconds later. The plan runs
from a timer in the worker process rather than as a repeatable job, so it
touches Redis only when it queues a send.

Sleep costs latency and nothing else. A send due while the worker sleeps starts
at most one check late, and the claim, the retries and the ceiling do not depend
on when a job starts. A delayed job is seen coming: the check looks two and a
half minutes ahead, so a send planned for 10:00:00 finds the worker awake.

## The sending week

Since 22 September 2026: Monday to Saturday, 09:00 to 18:59, on the
campaign's own clock, and nothing on Sunday. `planDay` answers `closed_day` on
a Sunday; the dispatcher's `retryAt` is always `nextOpening`, the next
Monday-to-Saturday 09:00 at or after now, so a Saturday evening waits for
Monday morning. The start hour is fixed at the opening (a CHECK holds it) and
the pause at thirty seconds plus jitter; neither is a setting.

A launch may name a day and hour (`send_after`). Until then the dispatcher
answers `scheduled_later` with `retryAt = send_after`: the campaign stays
`scheduled` and the worker plans at that second.

## When the plan runs

Until 22 September 2026 the plan ran every fifteen minutes from whenever the
process started. A campaign due at 10:00 met a plan at 9:58, before its start
hour, and the next one at 10:13; its first message left at 10:13. Each plan now
says when planning again would find something to send (`retryAt` in
`services/dispatch.ts`): the start hour, the next morning, the moment the
account's 24-hour window frees. The worker plans again at the earliest of
those, to the second (`jobs/planClock.ts`), and never waits longer than fifteen
minutes whatever they say.

The campaign's own daily pace is a rolling 24 hours, so yesterday's sends free
their slots one by one. The planner is given the instant each one leaves the
window and queues a send for it then, one second after, rather than finding the
day spent at 10:00 and waiting for the next pass.

Two more latencies were removed at the same time. A launch or a resume rings
the `cm:wake` channel after queueing its dispatch, and the sleeping worker
checks the queue at once instead of within two minutes; a subscribed
connection costs no command while it waits. And the dispatcher writes each
queued send's due time on its contact (`contacts.planned_at`), so the
interface counts down to the real second rather than to an estimate.

Planning and sending are separate because they fail differently. Planning is
cheap, idempotent and can be repeated; sending is the irreversible act.

---

## Idempotency, in three layers

A contact must never receive the same campaign email twice, including after a
worker is killed mid-run and restarted. Three independent mechanisms, because
any one of them can be defeated on its own.

### 1. The job id is the contact id

A send job is enqueued as `send-<contactId>` (BullMQ refuses a colon in a
custom id). BullMQ refuses a second job with
an id already present, so re-planning the same day — after a restart, or
because the schedule fired twice — cannot enqueue the same contact twice.

This alone is not enough: a completed job's id is eventually cleaned up.

### 2. The claim

Before anything is sent, the job claims its contact with one conditional
statement:

```sql
UPDATE contacts
SET claimed_at = now()
WHERE id = $1
  AND status = 'pending'
  AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  AND EXISTS (SELECT 1 FROM campaigns
              WHERE id = contacts.campaign_id AND status = 'running')
RETURNING id
```

No row returned means another worker holds it, it is no longer pending, or its
campaign was paused after the job was queued. The
job exits successfully: there is nothing to do, and failing would only schedule
a retry of a send that is already happening.

The ten-minute expiry exists for the worker that dies holding a claim. Without
it the contact is stranded forever; with it, it is reconsidered.

### 3. The unique index

`logs_one_sent_per_contact_idx` allows at most one `sent` event per contact,
ever. The row is inserted in the same transaction that marks the contact sent,
so a second recording fails at the database rather than in application code
that might have been changed since.

---

## The ambiguous case, and the choice it forces

Sending happens before recording. There is no way around that: Gmail has no
idempotency key, so the API call is made, and only then can the outcome be
written down.

If the process dies in that window, the contact is left claimed, with an
attempt counted and no `sent` log. Nothing can tell whether the message left.

**The policy is not to retry it.** The contact is marked `failed` with a message
saying the outcome is unknown, and the user decides.

That is the trade-off stated plainly: a missed email is recoverable by the
person who notices it, a duplicate is not. Anyone changing this should know
they are choosing the opposite.

Recognising the case needs `attempts` to be incremented immediately before the
API call and nowhere else, so a contact with `attempts > 0`, no `sent` log and
an expired claim is exactly the ambiguous one.

---

## Cadence

Each campaign carries `mails_per_day`, `start_hour` (always 09:00), `pause_ms`
(always thirty seconds) and a time zone, the browser's. The planner resolves
the start hour in the campaign's zone, not the server's: nine in the morning
must follow daylight saving,
which is why the schema stores an IANA zone and the validator refuses a fixed
offset.

Jobs are delayed, one per contact, spaced by `pause_ms`, thirty seconds for
every campaign since 22 September 2026 and no longer a setting, plus a random
jitter of up to twenty percent. The jitter is not decoration: a perfectly regular
interval is a signature, and sending in a burst is what gets an account
flagged.

---

## Quotas

Two ceilings, checked before planning and again before each send.

**The campaign's own**, `mails_per_day`, counted against what that campaign has
already sent during its local day.

**The account's**, `GMAIL_DAILY_LIMIT`, counted across every campaign the user
owns over a rolling 24 hours, the way Gmail counts it: 450. Google blocks a
personal account past 500, so the messages a user sends by hand from the same
mailbox still fit. No campaign may set a daily pace above 450, and the process
refuses to start with a ceiling above 500.

Reaching the account ceiling pauses the sending, not the campaign: its status
stays `running`, the planner queues nothing, and a job that reaches the
ceiling at send time leaves its contact untouched. Flipping the status to
`paused` would make the user resume by hand every morning. Nor does it fail
the contacts: they stay `pending` and go out once the 24-hour window frees.

---

## Failures, and which ones are worth retrying

Four kinds, and conflating them is how a queue spends its attempts against a
wall — or sends a message twice.

| Kind          | Examples                                          | What happens                                                                                           |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Transient     | 429, 500, 503, a 403 whose reason is a rate limit | Retried, three attempts, exponential backoff from one minute. Marked `failed` only after the last one. |
| No answer     | A dropped socket, a timeout                       | **Ambiguous**: the request may have reached Gmail. Marked `failed`, outcome unknown, never retried.    |
| Permanent     | 400 on a malformed recipient, a rejected address  | Marked `failed` immediately, with the reason. No retry can help.                                       |
| Authorization | `invalid_grant`, a revoked token                  | The **campaign is paused** and the user is told to reconnect. Contacts stay `pending`.                 |

The last is the one worth care. It is not a property of the contact, so
failing contacts one by one would burn through a list for a reason that has
nothing to do with any of them.

---

## Recording

Every outcome writes a row in `logs` and updates the contact, in one
transaction with the campaign's counters. A count that disagrees with the rows
is worse than no count, because it is believed.

A campaign moves to `completed` when no contact is left `pending` — checked
after each send rather than on a schedule, so the state is right the moment it
becomes true.

---

## What is deliberately not here

**No open or click tracking.** It needs a pixel and a redirect service, it
degrades deliverability, and it carries a consent obligation. Phase 9, as a
decision of its own.

**No sending on behalf of anyone but the signed-in user.** Every message uses
that user's own token and leaves from their own mailbox. There is no shared
sender and no relay.

**No bounce handling.** Gmail reports a hard failure at send time; a bounce that
arrives later lands in the user's inbox, where they can see it. Reading it back
would need a mailbox scope this application deliberately does not request.
