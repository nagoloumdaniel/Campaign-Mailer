# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Campaign Mailer sends personalized email campaigns from each user's own Gmail account. A user connects Google, imports a CSV of contacts, writes one template with merge variables, attaches a file such as a CV, and the backend sends the campaign over days at a controlled pace that stays under Gmail's daily quota.

The application is proprietary. Copyright holder: Daniel Nagoloum Talla. See `LICENSE`.

## State of the repository

**Phase 7 delivered, then the interface rebuilt at the owner's request (16–17 September 2026).** Phases 0 to 6 are complete: sign-in, campaigns, CSV import, attachments, the send engine, dashboard and statistics, data protection. Phase 7 added structured logs, Sentry, readiness and alerts, the throwaway-schema test runs, the Playwright journey and the documentation in `docs/`. The rebuild that followed put the web application on one design system and brought five rules with it: campaign types, five attachments, office-hours sending, the account-wide history with follow-ups, and the quota advice. Its migrations are applied to the development database. Phase 8 (production deployment) is next.

`ROADMAP.md` is the plan of record: ten phases, and within a phase one bullet is one ticket, one commit on `main`. Read it before starting work. It carries the definition of done for each phase and annotates every work item with the skills to load before implementing it.

`CONTRIBUTING.md` carries the commit conventions, the checks to run before a commit, and the three areas that need extra care. `docs/ARCHITECTURE.md` shows the components and the send flow; `docs/RUNBOOK.md` the incident procedures; `docs/send-engine.md` and `docs/security.md` the rules behind them.

## Working agreement with the repository owner

- **One phase at a time.** Work through every ticket of the current roadmap phase, then report and stop for review before starting the next phase. This replaced the earlier one-ticket-at-a-time rhythm on 12 September 2026, once Phase 1 was half done.
- **Still one commit and one push per ticket.** The phase is the review unit; the ticket stays the commit unit, so the history keeps naming what each change was for and a failure stays bisectable.
- Commit messages follow Conventional Commits, and the body explains why, not only what.
- Update the progress checklist in `README.md` in the same commit that advances it.
- Never start a Phase 9 item before Phase 8 is signed off. Scope drift toward post-MVP features is the project's most likely cause of delay.

## Commands

Run from the repository root.

```bash
npm install              # install all workspaces
npm run dev              # frontend and backend in watch mode (not the worker)
npm run dev:worker       # the send worker, only while working on sending
npm run verify           # format check, lint, typecheck, build: the gate
npm test                 # backend suite; database tests skip without DATABASE_URL
npm run test:coverage    # whole suite on a throwaway schema, fails under 70 % / 90 % in services
npm run test:e2e         # Playwright journey on a throwaway schema
npm run migrate:latest   # apply pending migrations (backend workspace)
npm run migrate:down     # roll back the last migration
```

Target a single workspace with `npm run <script> --workspace backend`. `npm run test:integration --workspace backend` is the whole suite on a throwaway schema without coverage.

Backend tests use Node's built-in runner through tsx. Run one file with `npx tsx --env-file-if-exists=.env --test src/services/encryption.test.ts` from `backend/`. `node:test` won over vitest because it adds no dependency and needs no configuration. The frontend has no unit runner; it is covered by the Playwright journey.

Test files live beside the code they cover: `*.test.ts`, and `*.integration.test.ts` for those needing PostgreSQL. `tsconfig.json` keeps them in the program so `typecheck` covers them; `tsconfig.build.json` excludes them, and `src/e2e/`, from `dist/`.

Before a commit: `npm run verify`, plus `npm run test:coverage` when backend code changed and `npm run test:e2e` when a user flow changed. GitHub Actions does not run (see Environment notes), so these local runs are the only gate.

## Stack, and the three deliberate departures from the specification

The French specification (`Cahier des Charges v1.0`) left several alternatives open. They were closed on 10 September 2026: PostgreSQL, BullMQ on Redis, Express, React 19 + Vite + Tailwind, Passport.js with the Google OAuth 2.0 strategy, Vercel for the frontend, Railway for the backend.

Three choices contradict the written specification on purpose. Do not "correct" them back:

- **TypeScript, not JavaScript.** The data model carries four state enums. A typo on a status string would corrupt the campaign state machine silently.
- **Gmail API REST (`users.messages.send`), not Nodemailer SMTP.** PaaS hosts block or throttle outbound SMTP, and the REST call reuses the OAuth token already obtained at login. Nodemailer may still be used to build the MIME payload.
- **S3-compatible object storage (Cloudflare R2), not Google Drive.** Drive would add a second sensitive OAuth scope alongside `gmail.send`, which makes Google's verification heavier, and the attachment is re-read on every send.

Postgres, Redis and the attachment bucket are **hosted from the start** — Neon, Upstash and Cloudflare R2 — not run locally in Docker. Docker is not installed on the owner's machine, and using the same services in development and production removes a class of environment drift. This means real connection strings live in `backend/.env` from Phase 0 onward; `.gitignore` already blocks `.env`.

Neon rather than Supabase for one reason worth remembering before suggesting a switch back: Supabase caps its free tier at two active projects per owner, and the owner's quota is already full. Neon's free plan scales the compute to zero after five minutes idle, which makes development effectively free but would not carry a 24/7 production API within the monthly compute allowance. The production database is a Phase 8 decision, deliberately left open.

Neon needs **two** connection strings. The pooled host carries `-pooler` and serves the API and the worker; the direct host has no `-pooler` and is used only by migrations, because the pooler does not support the session-level statements a migration runs.

Both carry `sslmode=verify-full`, not the `sslmode=require` Neon's console hands out. node-postgres warns that `require` will adopt libpq semantics in pg 9, where it encrypts without verifying the server certificate. Naming `verify-full` pins certificate verification rather than inheriting whatever the default becomes.

The provisioned services all sit in **us-east-1**: Neon project `campaign-mailer` (PostgreSQL 18.6), Upstash Redis `campaign-mailer`, and the Cloudflare R2 bucket `campaign-attachments` in the ENAM location. They are deliberately co-located, so the Railway backend belongs in a US East region too. Deploying the API to a European region would put a transatlantic round trip on every query and every queue operation.

## Architecture, and where the risk sits

Three layers, and the boundaries matter:

- **Routes** validate the payload with a schema, check ownership and delegate; there is no separate controller layer. A route that queries the database directly will be sent back in review. `signedInUserId` and `campaignIdParam` in `middleware/auth.ts` are the one way to read the user and the campaign id.
- **Services** (`backend/src/services/`) hold the business rules and are the only layer that talks to the database or to an external API.
- **Jobs** (`backend/src/jobs/`) are BullMQ workers. They run in a process separate from the API.

The send engine, spread across `services/` and `jobs/`, is the part of this codebase where a defect is not recoverable. A duplicate send reaches a real recipient and cannot be undone, and an over-aggressive send can get a user's Google account suspended. Three properties are non-negotiable there:

- **Idempotency.** A contact must never receive the same campaign email twice, including after a worker is killed mid-campaign and restarted. Enforced by the job id (`send-<contactId>`), a conditional claim on the contact, and a unique index allowing one `sent` log row per contact (`logs_one_sent_per_contact_idx`). A contact whose attempt was counted but never recorded is marked failed, outcome unknown, and never resent.
- **A campaign state machine.** `draft → scheduled → running → paused → running → completed`. Any transition outside that graph is rejected with a 409, not silently applied.
- **Office hours only.** Nothing goes out before 10:00 or after 17:59 on the campaign's own clock. The rule is the owner's, taken on 16 September 2026, and it is about how the message is received rather than about Gmail: a candidature landing at three in the morning reads as automated. `LAST_SEND_HOUR` lives in `services/planner.ts`, the choosable start hour is bounded in `schemas/campaign.ts`, and a CHECK constraint holds the column. The planner also stops a day's plan where the window closes, so 450 messages thirty seconds apart do not deliver into the night; what does not fit waits for the next morning. A campaign launched at 18:30 therefore starts the next day, and `LaunchDialog` says so before the click.
- **A hard daily cap** below Gmail's own limit. Google blocks a personal account past 500 messages over a rolling 24 hours; the application stops each account at 450 (`GMAIL_DAILY_LIMIT`, refused above 500) and no campaign may ask for more. Reaching it holds the sending without changing the campaign's status: it stays `running` and resumes by itself when the window frees, and the interface says so. The owner decided this on 14 September 2026, over the roadmap's original "pause the campaign", because a paused campaign would need resuming by hand every morning. Two sends are at least 10 seconds apart, 30 by default.

The worker is not part of `npm run dev`. Upstash's free tier counts every Redis command, and an idle BullMQ worker polls: start it with `npm run dev:worker` only while working on sending. BullMQ runs one queue with two job kinds (`dispatch`, `send`) rather than two queues, because each queue needs its own polling worker.

The worker also puts itself to sleep while nothing is due (`jobs/idleSleep.ts`), which is what lets it run around the clock on the free tier. Measured against Upstash on 14 September 2026: 12 commands a minute awake and idle (about 518 000 a month, over the 500 000 allowance), 1 a minute asleep (about 43 000). BullMQ's Redis backend caps a blocking wait at ten seconds, so no BullMQ setting achieves this; do not remove the sleep in favour of tuning `drainDelay`. The cost the owner accepted: a job queued while the worker sleeps starts at the next check, within two minutes (89 seconds in the measurement). The plan runs from a timer in the worker process rather than a repeatable BullMQ job, so it does not wake the queue for nothing.

**The plan runs at the second something becomes sendable, not every fifteen minutes.** Until 22 September 2026 it ran every quarter of an hour from process start: a campaign due at 10:00 met a plan at 9:58 and the next at 10:13, and the owner saw the first message leave at 10:13. Each dispatch now returns a `retryAt` (start hour, next morning, account window freeing) and `jobs/planClock.ts` sets the next plan to the earliest, fifteen minutes at the longest. The planner also receives when each of the campaign's sends leaves its 24-hour window (`campaignFreesAt`) and queues the next send at that second. A launch or resume publishes on `cm:wake`, which wakes a sleeping worker at once. Do not go back to a fixed interval.

`contacts.planned_at` is when the dispatcher queued a contact's send to run. It is display data for the countdown, never a rule: it is only overwritten once past, because the queue keeps the first job for a contact and ignores the second.

Two other sensitive areas: Google access and refresh tokens are encrypted at rest with AES-256-GCM and must never appear in a log line, an error message or an API response; and every value interpolated into an email template is attacker-controlled input from a CSV file, so it is escaped without exception.

Sessions live in Redis and the cookie carries nothing but a session id; the session itself holds only the user id, so a Redis dump exposes no email and no token. The cookie is `sameSite: 'lax'`, not `'strict'` — Google redirects the browser back to the callback, and a strict cookie is withheld on that navigation, which breaks the OAuth state check and reads as a broken login. `createApp` takes the session store as an argument so a test can build the application without a Redis connection.

**The session store uses node-redis, not ioredis.** connect-redis 10 declares `redis >= 5` as its peer and calls `client.set(key, value, { expiration: … })`, an options object ioredis does not parse: paired with ioredis every session write fails with `ERR syntax error` and no session is ever stored. BullMQ runs on ioredis, alongside this one. Two Redis libraries is deliberate — each used with the partner it supports. BullMQ 6 does ship a node-redis adapter, and it was tried first on 14 September 2026: against Upstash the adapter waits for `CLIENT SETNAME` before marking a duplicated client ready, Upstash does not honour it, and the worker's blocking connection never became ready, so delayed jobs were never picked up. The same smoke test over ioredis ran a two-second delayed job at 2.2 s. Do not switch BullMQ to node-redis without repeating that test against Upstash.

Every call into the Gmail API goes through `createAccessTokenProvider` in `services/tokenRefresh.ts`, which returns a plaintext token and renews it when needed. It distinguishes two failures, and the send engine must keep them apart: `ReauthorizationRequiredError` means retrying is pointless — the user revoked access, changed their password, or the app is in Testing where refresh tokens expire after seven days — so the campaign pauses and the user is told; any other error is transient and may be retried. Treating the first as retryable would burn the queue's attempts against a wall.

`state: true` belongs in the **strategy** options, not in the options passed to `passport.authenticate`. passport-oauth2 reads it at construction to install a session-backed state store; passed to `authenticate()` it is treated as a literal value to forward, and no CSRF protection is installed while the code still looks correct.

The **pace of a campaign stays editable while it runs** (`canEditCadence`), which it did not until 16 September 2026. The old rule froze it on the argument that a running campaign already has its day planned; the argument does not hold, because the planner re-reads those columns every fifteen minutes and the account ceiling is counted from the logs rather than from the plan. What it did cost was the one thing a user with three live campaigns needs: sharing one allowance between them without pausing all three. The dashboard's quota advice (`services/quota.ts`, `components/dashboard/QuotaAdvice.tsx`) writes through it.

A campaign carries a **`type`** — prospection, relance, marketing, alternance, autre — which drives no send rule. It groups the history and tells a follow-up apart from the run it came from. It is in neither `CONTENT_FIELDS` nor `CADENCE_FIELDS`, so it stays editable in every state: filing a finished run under the right category is exactly the sort of tidying done afterwards.

**Attachments are rows, not columns.** `campaign_attachments` replaced `attachment_key` / `attachment_name` on 16 September 2026: a candidature carries a CV, a cover letter and sometimes a transcript, and one column could hold one file. Five at most, enforced inside the INSERT rather than by a count followed by a write, so two uploads finishing at once cannot both read four. A file the cap refuses is deleted from the bucket rather than left orphaned.

**The address book** (`/api/contacts`, `services/addressBook.ts`, page `/contacts`) lists every contact of the account across its campaigns, searchable, sortable from a fixed map of `ORDER BY` clauses (never a column name from the request), paginated. It is a view, not a second store: a contact still belongs to one campaign. Adding and editing are allowed only while that campaign is a draft, checked inside the SQL write itself; removing is always allowed, the send log keeping its line with the contact detached. `contacts.source` (`csv`, `manual`, `mailfind`) says where a contact came from; a follow-up copies it.

**`GET /api/history`** lists every message the account has sent, across every campaign, read from `logs` rather than from `contacts.sent_at`: the log is the record of what actually left, and `logs_one_sent_per_contact_idx` guarantees one row per delivery, so a follow-up's recipients are not counted twice against the original run. An error row with no contact is a pause reason, not a failed send, and is excluded. `POST /api/campaigns/follow-up` turns a selection of contact ids into a new draft campaign of type `relance`, copying the contacts server-side with the owner check in the SQL — an id from another account selects nothing.

The **live preview** in the campaign editor renders the merge in the browser (`frontend/src/services/merge.ts`), mirroring `backend/src/services/template.ts` rule for rule. The duplication is deliberate and narrow: what actually leaves the account is rendered by the server, always, and the API's preview route renders the _stored_ campaign, so it could only ever show the last save rather than the sentence being typed. The result goes into an iframe with an empty `sandbox` attribute.

The database schema started from section 5 of the specification (`users`, `campaigns`, `contacts`, `logs`), gained `audit_events` in Phase 6 and `campaign_attachments` in the interface rebuild. Every migration ships with a working rollback.

## Observability

- **Logs** are JSON from pino (`logger.ts`), silent under the test runner. Requests carry `req.id`, returned as `x-request-id`; job lines carry `jobId`, `campaignId`, `contactId`. The request serializer logs method and path only: the default one would log the session cookie and the OAuth `code` in the callback's query string. Tokens are redacted by path.
- **Sentry** (`services/errorReporting.ts`, and its frontend twin) is a no-op without `SENTRY_DSN` / `VITE_SENTRY_DSN`. `scrubEvent` drops cookies, headers, bodies, query strings, and redacts addresses and Google tokens from every message. A Gmail refusal is a warning grouped by fingerprint, not an error per contact. Without a DSN, Vite drops the frontend SDK from the bundle entirely.
- **`/api/ready`** checks the database, the session store and the queue (two seconds each, in parallel) and reports queue depth and the worker heartbeat. The worker's absence does not make the API unready: restarting the API would not fix it.
- **Alerts** (`services/alerts.ts`): send error rate above 5 % over an hour from 10 attempts, run in the worker right after the plan so Neon is not woken for it; queue stuck for 15 minutes and worker heartbeat older than 15 minutes, run from the API every five minutes on Redis only (`WORKER_MONITOR`, on in production). Each is notified when it starts, every six hours while it lasts, and when it ends.

## Environment notes

The owner develops on Windows 11 with PowerShell 5.1 and Node 24.

- `.gitattributes` normalizes the repository to LF. Do not add files that fight it.
- PowerShell's execution policy is `Restricted` on this machine, which prevents `.ps1` scripts from running. This will break husky hooks and any npm binary shipped as `.ps1`. Fix without admin rights: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **GitHub Actions does not run.** As of 11 September 2026 the API answers `422: Actions has been disabled for this user` on a dispatch, while the repository's own setting reports `enabled: true` and the workflow reports `state: active`. The restriction sits on the account, not the repository, so no change to `ci.yml` or to repository settings will lift it. The owner has to resolve it at github.com (billing, email verification, or support). Until then the pipeline is untested and `npm run verify` locally is the only gate.
- **Never pipe a commit message into `git commit` from PowerShell.** A here-string piped in gains a byte-order mark at the start of the subject. Use `-m` or `-F <file>`. Stage explicit paths only.
- **`spawn` with `shell: true` on Windows** splits `C:\Program Files\nodejs\node.exe` at the space, and passing an argument array to a shell raises DEP0190. `scripts/withTestDatabase.mjs` runs node without a shell and the user command as one quoted line.
- **PowerShell strips backticks** inside `node -e "..."`; use single quotes or a scratch file (`.mts` when it needs top-level await under tsx).
- **An unescaped BOM character in source** fails ESLint's `no-irregular-whitespace`. Write `\uFEFF`.
- A broken npm was diagnosed and fixed on 10 September 2026: a stale `minipass` 3.3.6 nested under npm's own `minizlib` shadowed `minipass` 7.1.2, and since minizlib v3 reads the named `Minipass` export that 3.x does not provide, every npm command on the machine failed with `Class extends value undefined is not a constructor or null`. If that error reappears after a Node upgrade, look for a nested `minipass` under `node_modules/npm/node_modules/minizlib/` and remove it.

## Testing pitfalls met so far

- **Integration test files run in parallel against one database.** A cleanup by prefix (`google_id LIKE 'itest-%'`) deleted the accounts of neighbouring files mid-test and failed them with foreign-key violations. Create rows under a unique id and delete exactly those.
- **The throwaway schema** works because Neon's direct host accepts `options=-c search_path=<schema>` in the connection string. The pooled host does not; `withTestDatabase.mjs` refuses it. Migrations go into the schema with node-pg-migrate's `--schema`.
- **A query over a global table** (the error rate counts every log row) cannot be tested by counting in a shared database. `alerts.integration.test.ts` does it inside one `REPEATABLE READ` transaction that is rolled back.
- **Coverage from Node's runner counts comments, `import type`, interfaces and type aliases as uncovered lines**, through source maps. `src/scripts/checkCoverage.ts` sets them aside with the TypeScript parser; do not lower the thresholds because a documented file reads badly in the raw table.
- **Test sessions without Google**: `src/e2e/session.ts` writes the session into the store and signs its id as express-session does. Do not add a login route or flag to the application for tests. `src/e2e/server.ts` refuses to start unless `NODE_ENV=test`, `E2E=1` and `DATABASE_URL` points at a `test_` schema.
- **Playwright locators are strict.** "Enregistrer" also matches "Enregistrer le rythme", "À jour" is said by both the header button and the cadence panel, and the campaign page has three file inputs (attachments, the import dialog, and the dialog's own). Use `exact: true`, `.first()`, and scope to the dialog or region that owns the control.
- **The end-to-end run pins the planner's clock to noon UTC** (`src/e2e/server.ts`). Sending only happens between 10:00 and 17:59 on the campaign's clock, and the suite runs whenever somebody runs it; without the pin a journey started at midnight would plan nothing. The same reasoning put a `noonUtc()` default in `jobs/pipeline.integration.test.ts`. Only the clock is pinned — which contacts are picked, how many, and the ceiling they are checked against are the real rules.
- **`req.params` is typed `{}`** on a router mounted with `mergeParams`, though it is filled at runtime. Read the campaign id through `campaignIdParam`.

## Google OAuth verification

`gmail.send` is a sensitive scope. In Testing mode the OAuth consent screen works immediately but is capped at 100 users. Verification for production can take weeks, which is why the roadmap files the request in Phase 0 rather than before launch. Adding a second sensitive scope would make that review heavier, so treat any new scope as an architectural decision.

Two scopes are worse than sensitive: `gmail.readonly` and `gmail.modify` are **restricted**, and requesting either pulls the project into an annual third-party security assessment. The Phase 9 reply-detection feature is the only planned work that would need read access, so it is a decision to take deliberately rather than a scope to add in passing.

While the app stays in Testing, refresh tokens expire after seven days. An `invalid_grant` in development usually means that, not a bug in the token service.

The full console procedure, and what each OAuth error actually means, is in `docs/google-oauth-setup.md`.
