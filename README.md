# Campaign Mailer

[![CI](https://github.com/Nagoloum/Campaign-Mailer/actions/workflows/ci.yml/badge.svg)](https://github.com/Nagoloum/Campaign-Mailer/actions/workflows/ci.yml)

Web application to create, personalize and send email campaigns at scale, from the user's own Gmail account.

Each user connects their Google account, imports a contact list, writes one template with merge variables, attaches a file such as a CV, then lets the application send the campaign at a controlled pace that respects Gmail's daily quota.

Intended users: students sending applications, recruiters, and small B2B prospecting campaigns.

---

## Status

**Sending on the second (22 September 2026).** A campaign due at 10:00 used to wait for the worker's next quarter-hour plan and leave at 10:13; the plan now runs at the exact instant something becomes sendable, a launch wakes the worker at once, and each queued send's time is stored so the campaign page and the dashboard count down to it live, with a bar that fills until it leaves. The daily pace is hidden when a campaign fits in one day, and the message preview reads like an opened email, on a computer or a phone, stepping through the first ten contacts. The roadmap gains recipient verification and the integration with MailFind, the companion project that finds the addresses.

**Interface rebuilt, awaiting review (16 September 2026).** The whole web application was redesigned around a shared design system: one palette in two themes, one type scale, one icon family, and a floating navigation over three destinations — accueil, campagnes, historique. Every page now has a skeleton while it loads, an empty state when there is nothing, and a confirmation before anything irreversible. The campaign editor is split, writing on the left and a preview on the right that follows the keyboard; the "Générer l'aperçu" button is gone.

Five changes go deeper than the interface, and each came with its migration and its tests: a campaign now has a **type** (prospection, relance, alternance / stage, marketing, personnalisée); it carries up to **five attachments** instead of one; sending is restricted to **office hours, 10:00–17:59** on the campaign's own clock, so a campaign launched in the evening starts the next morning; an **historique** lists every message the account has sent and turns a selection into a follow-up campaign without re-importing anything; and the dashboard **proposes a split of the daily allowance** when several live campaigns together ask for more than it holds.

**Phase 7 — tests, observability and documentation, awaiting review.** Structured logs carry a request id and a job id; errors reach Sentry once a DSN is set; `/api/health` and `/api/ready` report the process, its dependencies, the queue depth and the worker's heartbeat; alerts fire on a send error rate above 5 %, a stuck queue and a stopped worker. The backend suite runs on a throwaway database schema with coverage enforced (89 % of lines overall, 95 % in `services/`), and a Playwright test drives the whole journey in a browser. A runbook and an architecture document are in `docs/`.

Phases 0 to 6 are complete: sign-in with Google, campaign editing, CSV import, attachments, the send engine (real test passed on 14 September 2026: five emails, all accepted, none sent twice), the dashboard and statistics, and data protection (export, account deletion, audit log, retention, key rotation, published terms).

The plan of record is [ROADMAP.md](ROADMAP.md): ten phases, from an empty repository to public launch, each with work items, a definition of done and its own risks.

Still open from Phase 0: the Google verification request. Until it is filed and granted, the consent screen is capped at the test users and refresh tokens expire after seven days.

---

## Stack

Decided on 10 September 2026. The reasoning, including three deliberate departures from the specification, is in the decision table of [ROADMAP.md](ROADMAP.md#phase-0--fondations-et-décisions-gelées).

| Layer         | Choice                                                        |
| ------------- | ------------------------------------------------------------- |
| Frontend      | React 19, Vite, TypeScript, Tailwind CSS, React Router        |
| Backend       | Node.js, Express 5, TypeScript                                |
| Database      | PostgreSQL on Neon                                            |
| Queue         | BullMQ on Redis (Upstash)                                     |
| Email         | Gmail API (`users.messages.send`) over OAuth 2.0              |
| Auth          | Passport.js, Google OAuth 2.0 strategy                        |
| Attachments   | Cloudflare R2, S3-compatible                                  |
| Observability | pino (JSON logs), Sentry                                      |
| Tests         | Node's test runner through tsx, Playwright                    |
| Hosting       | Vercel (frontend), Railway (backend); production database TBD |

How the pieces fit, and how a campaign becomes messages: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Repository layout

```text
campaign-mailer/
├── frontend/           React + Vite single-page application
├── backend/            Express API, send worker, migrations
│   ├── src/            routes, middleware, services, jobs
│   ├── migrations/     SQL migrations, each with its rollback
│   └── scripts/        migration wrapper, throwaway test database
├── e2e/                Playwright end-to-end tests
├── docs/               Architecture, runbook, send engine, security, OAuth setup
├── ROADMAP.md          Plan of record, phase by phase
├── CONTRIBUTING.md     How work is done in this repository
├── CLAUDE.md           Repository guide for Claude Code
├── LICENSE             Proprietary. All rights reserved.
└── package.json        npm workspaces root
```

---

## Requirements

- Node.js 24 (see `.nvmrc`; 22 is the minimum), npm 10 or later.
- Accounts on **Neon** (PostgreSQL), **Upstash** (Redis) and **Cloudflare R2** (attachment storage). The same hosted services are used in development and in production, so nothing is installed locally and Docker is not needed. All three free tiers cover development.
- A **Google Cloud project** with the Gmail API enabled and OAuth 2.0 web credentials. Step by step in [docs/google-oauth-setup.md](docs/google-oauth-setup.md).
- Optional: a **Sentry** project, for error reporting and alerts.

On Windows, allow local scripts before installing, or the git hooks will not run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## Local setup

```bash
git clone https://github.com/Nagoloum/Campaign-Mailer.git
cd Campaign-Mailer
npm install
```

Copy the environment templates, then fill them in (see the next section).

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`SESSION_SECRET` and `ENCRYPTION_KEY` are generated, not chosen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Apply the migrations, then start the API and the web app:

```bash
npm run migrate:latest
npm run dev
```

The web app is at <http://localhost:5173>; it proxies `/api` to the API on port 3000. Sign in with a Google account listed as a test user on the OAuth consent screen.

The send worker is not started by `npm run dev`: an idle worker spends Redis commands, which the Upstash free tier counts. Start it in a second terminal only when you want campaigns to send:

```bash
npm run dev:worker
```

---

## Environment variables

Each template explains every variable in place. The ones the backend refuses to start without are marked required.

### `backend/.env`

| Variable                                                               | Required                 | Purpose                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                         | yes                      | Neon **pooled** connection (host contains `-pooler`), `sslmode=verify-full`. Used by the API and the worker. |
| `DATABASE_DIRECT_URL`                                                  | for migrations and tests | Neon **direct** connection (no `-pooler`). Migrations and the throwaway test schemas use it.                 |
| `REDIS_URL`                                                            | yes                      | Upstash `rediss://` URL. Sessions and the queue.                                                             |
| `SESSION_SECRET`                                                       | yes                      | Signs the session cookie, at least 32 characters. Changing it signs everyone out.                            |
| `ENCRYPTION_KEY`                                                       | yes                      | 64 hex characters. Encrypts the Google tokens at rest. Losing it forces every user to reconnect.             |
| `ENCRYPTION_KEY_PREVIOUS`                                              | no                       | Only during a key rotation. See [docs/security.md](docs/security.md).                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                             | yes                      | OAuth web client.                                                                                            |
| `GOOGLE_CALLBACK_URL`                                                  | yes                      | Must match an authorized redirect URI exactly.                                                               |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes                      | Cloudflare R2 bucket and a token scoped to it. `S3_REGION` defaults to `auto`.                               |
| `FRONTEND_URL`                                                         | no                       | Origin of the web app, for CORS and redirects. Defaults to `http://localhost:5173`.                          |
| `PORT`                                                                 | no                       | API port, 3000 by default.                                                                                   |
| `GMAIL_DAILY_LIMIT`                                                    | no                       | Messages per account over a rolling 24 hours. 450 by default, refused above 500.                             |
| `LOG_LEVEL`                                                            | no                       | `debug` in development, `info` in production.                                                                |
| `SENTRY_DSN`                                                           | no                       | Error reporting. Off when empty.                                                                             |
| `WORKER_MONITOR`                                                       | no                       | Worker and queue alerts from the API. On in production, off elsewhere.                                       |

### `frontend/.env`

Everything here ends up in the browser bundle: no secret belongs in it.

| Variable           | Purpose                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `VITE_BACKEND_URL` | Where the dev server proxies `/api`. Defaults to `http://localhost:3000`. |
| `VITE_SENTRY_DSN`  | Browser error reporting. Off when empty.                                  |
| `VITE_LEGAL_*`     | The publisher's identity on the legal notice.                             |

---

## Commands

Run from the repository root.

| Command                  | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `npm run dev`            | API and web app in watch mode                                                   |
| `npm run dev:worker`     | The send worker in watch mode (only while testing sends)                        |
| `npm run build`          | Production builds of both workspaces                                            |
| `npm run verify`         | Format check, lint, typecheck and build: the gate before every commit           |
| `npm run lint`           | oxlint on the frontend, ESLint on the backend                                   |
| `npm run format`         | Rewrite the repository with Prettier                                            |
| `npm run typecheck`      | `tsc --noEmit` in both workspaces                                               |
| `npm test`               | Backend suite; the database tests skip when `DATABASE_URL` is unset             |
| `npm run test:coverage`  | Whole backend suite on a throwaway schema, failing under the coverage objective |
| `npm run test:e2e`       | Playwright journey in Chromium on a throwaway schema                            |
| `npm run migrate:latest` | Apply pending migrations                                                        |
| `npm run migrate:down`   | Roll back the last migration                                                    |

`npm run test:integration --workspace backend` runs the whole suite on a throwaway schema without coverage. The first `npm run test:e2e` needs the browser once: `npx playwright install chromium`.

Create a migration with `npm run migrate:create --workspace backend -- <name>`.

---

## Tests

- **Unit and route tests** sit beside the code as `*.test.ts` and run with Node's test runner through tsx.
- **Integration tests** (`*.integration.test.ts`) run against PostgreSQL. `test:coverage` and `test:integration` create a schema named `test_<time>_<pid>` on the direct connection, apply every migration into it, run the suite there and drop it, so the tests never touch development data.
- **End-to-end**: `e2e/journey.spec.ts` signs in, accepts the terms, creates a campaign, imports a CSV, launches and follows it until both messages are out. The API runs from `backend/src/e2e/server.ts`, where Google sign-in and Gmail are replaced; that file refuses to start outside a test schema and is excluded from the build.

---

## Operating it

- Health: `GET /api/health` (the process is up), `GET /api/ready` (database, sessions and queue answer; queue depth; worker heartbeat).
- Incidents and procedures: [docs/RUNBOOK.md](docs/RUNBOOK.md).
- Security, key rotation, retention: [docs/security.md](docs/security.md).
- How sending works and why: [docs/send-engine.md](docs/send-engine.md).

---

## Sending limits and responsible use

Gmail blocks a personal account that sends more than 500 messages over a rolling 24 hours ([Google's limits](https://support.google.com/mail/answer/22839)). The application stops each account at 450, across all its campaigns, and refuses a daily pace above that. When the ceiling is reached a running campaign stays running, sends nothing, tells the user why, and resumes by itself once the window frees. Two sends are at least 10 seconds apart, 30 by default, plus a random jitter.

Exceeding the cap, or sending an identical message to a large list, can get a Google account suspended and can damage sender reputation. Anyone operating this application is responsible for the messages they send, for complying with data protection law and with law governing unsolicited commercial email, and for honouring unsubscribe requests.

---

## License

Proprietary. Copyright (c) 2026 Daniel Nagoloum Talla. All rights reserved.

No right to use, copy, modify or distribute this software is granted. See [LICENSE](LICENSE) for the full terms, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting any contribution.
