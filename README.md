# Outgrow Console

Acsia's internal app for running the **Outgrow** method (proactive, permissioned selling inside existing customer accounts). One admin, invite-only employees, role-aware screens, and a data model that never shows revenue, pipeline values or competitor names to delivery engineers.

> **Status: Milestone 2 (the operator).** Sign-in, roles, admin, the database with row-level security, Today, Prep, the Log flow, Accounts, Team, Scorecard and Library are built (M0 and M1), and M2 adds the AI operator: the Monday planner, the Friday scorecard draft, the guardrail explainer, the quarterly analyst, scheduled jobs and the Operator screen. Milestone 3 is not started. Read `LIMITATIONS.md` for what the free plans limit and what has not been tested against real services, and `DECISIONS.md` for the choices made along the way.

## Stack

Next.js 15 (App Router, TypeScript strict) on Vercel · Supabase (Postgres, Auth, RLS) · Tailwind CSS 4 + Radix · zod at every boundary · server components and server actions · OpenRouter for AI (server-side only) · Vercel Cron for scheduled jobs.

## Run it locally

```bash
npm install
cp .env.example .env.local      # fill in the values (see below)
npm run dev                     # http://localhost:3000
```

Node 22.

## Environment variables

Names only. Put values in Vercel (Project → Settings → Environment Variables) or a local, git-ignored `.env.local`. Never commit them.

| Variable | Where it's used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server (Supabase publishable key; safe because RLS protects data) | No |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only**: admin invites, sign-in links, seeding, cron | **Yes** |
| `NEXT_PUBLIC_APP_URL` | Auth redirects, OpenRouter referer | No |
| `ADMIN_EMAIL` | The single admin. Synced to `app_settings.admin_email` by the seed | No |
| `ALLOWED_EMAIL_DOMAIN` | Optional second sign-up gate (e.g. `acsiatech.com`) | No |
| `APP_TIMEZONE` | Defaults to `Asia/Kolkata` | No |
| `OPENROUTER_API_KEY` | **Server only.** Without it every AI feature falls back to plain forms and the rules-only planner | **Yes** |
| `AI_MONTHLY_BUDGET_USD` | Monthly AI budget, default 150. Leaders are alerted at 80%; the operator stops at 100% | No |
| `CRON_SECRET` | Protects `/api/cron/*` (Vercel sends it as a Bearer token). If unset, the endpoints answer 503 and run nothing | **Yes** |

## Database

Everything lives in `supabase/migrations/` (0001 to 0017) and is applied in order.

- **Default-deny.** Every table has RLS on. Business writes only go through `SECURITY DEFINER` functions (`log_conversation`, `create_assignment`, and so on) that re-check the caller's role.
- **Roles come from the database on every request** (`get_me()`), never from a token claim.
- **Mixed tables** (accounts, contacts, opportunities, actions...) are read through `*_safe` views that return `NULL` for restricted columns, so a delivery engineer's API calls physically cannot return revenue, pipeline values or competitor names.
- **Sign-up gate.** The Before User Created hook (`public.hook_before_user_created`) rejects anyone not on the roster (or not the admin).

### Tests

**Database.** Two pure-SQL files, each in one transaction that always rolls back:

- `supabase/tests/rls.sql`: 295 assertions across every role (anonymous, stranger, engineer, PM, delivery lead, AE, SDR, pre-sales, leader, CEO, admin), the log-a-conversation rules, the sign-up gate, scorecard rules and "remove examples".
- `supabase/tests/m2.sql`: 99 assertions for the scheduled-job claims, list membership, planner saving and approval, AI acceptance, the AI dashboard and the analyst input.

```bash
# Local Postgres only (uses a stub of Supabase's auth schema in supabase/tests/00_stub_supabase.sql)
npm run test:rls
```

A passing run prints `RLS_TESTS_PASSED <n> assertions` and `M2_TESTS_PASSED <n> assertions`. The script expects a scratch Postgres at `/tmp/pgtest:54329`; edit `scripts/rebuild_scratch.sh` for another location. Do not point it at a database that holds real data unless you understand the tests roll back; they create fixtures inside their transaction.

**Code.**

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint, zero warnings allowed
npm test                   # 156 unit tests (Vitest): planner, scorecard writer, analyst, schedule, guardrails, log rules...
npm run build && npm start # then, in another terminal:
npx playwright test --project=public-desktop --project=public-mobile   # signed-out surface, no credentials needed
```

The signed-in Playwright specs (`*.authed.spec.ts`, see `tests/e2e/README.md`) need one test user per role in a **staging** Supabase project. They have not been run against this deployment.

In an environment that can't reach Google Fonts (a locked-down CI box, say), `next build` fails on the font download. Point `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` at a small module that returns stub font CSS. This affects only the local build, never Vercel.

### The AI operator

Nine jobs (capture, transcribe, follow, brief, plan, score, coach, guard, analyst), all through one module: `src/lib/operator/run.ts`. Each call passes, in order: key present, job switched on, per-person rate limit (10 a minute, 200 a day, person-triggered jobs only), monthly budget. Then the primary model, then a fallback, then validation and a scrub for conversion rates and forecasts. Every call writes one `ai_runs` row that the **Operator** screen shows (cost, delay, acceptance). The Outgrow leader and the admin can change each job's model, fallback model, temperature, token limit and on/off switch there; prompts live in code (`src/lib/operator/prompts.ts`).

Rules that hold for every job: the AI never writes a deal stage or owner; email is never suggested as a channel; nothing Acsia does not offer is proposed; no conversion rate or forecast reaches a person (except the quarterly analyst, from week 12, with rates the database computed). Prompts for person-triggered jobs are built from the caller's own database view, and the scorecard and analyst prompts carry only counts, first names and percentages. Where a rule can be checked in code, it is checked again after the model answers, and a draft that fails is dropped rather than repaired.

### Scheduled jobs

`vercel.json` lists four crons. All times are Asia/Kolkata; on Vercel Hobby each can fire up to about an hour late and only on the production deployment.

| Path | When | What |
|---|---|---|
| `/api/cron/daily` | every day, 06:00 | refresh derived fields and the who-to-call lists |
| `/api/cron/monday` | Mondays, 07:00 | draft the week's assignments for managers to approve |
| `/api/cron/friday` | Fridays, 14:00 | freeze the week's numbers and draft the scorecard commentary |
| `/api/cron/monthly` | 1st of the month | quarterly analyst review (skipped before programme week 12) |

Each run is claimed per period in `job_runs`, so a retry or double delivery does nothing. Leaders can run any job now from the Operator screen. To trigger one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/daily`.

### Seed (reference data only)

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_EMAIL=... npm run seed
```

Idempotent. It loads the library (service lines, plays, picklists, action codes, channel rules, focus calendar, list definitions, AI routes) and sets the admin email. Demo accounts and people are **never** seeded; the admin loads them from **Admin → Data import**, and removes them with one click.

## Deploying

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order.
2. Supabase → Authentication → **Hooks** → enable **Before User Created** → Postgres function `public.hook_before_user_created`.
3. Supabase → Authentication → **URL Configuration** → set Site URL to the app URL and add `<app URL>/**` to Redirect URLs.
4. Create a Vercel project from this repo (branch `v2`) and set the environment variables above, including `CRON_SECRET`. Crons only run on the **production** deployment, so set the project's Production Branch to `v2`.
5. Sign in as the admin, open **Admin → Data import → Load library**, add employees under **Admin → Employees**.
6. Before inviting real employees, set up custom SMTP in Supabase (Authentication → Emails → SMTP Settings). On the Free plan the built-in mailer only reaches Supabase team members; until then use **Copy sign-in link** on the Employees screen.

## Layout

```
src/app/            routes (login, auth/*, welcome, (app)/* signed-in screens)
src/components/     shell, sheets, ui
src/lib/            env, roles, dates, outgrow rules, import, seeds, supabase clients
src/lib/operator/   the AI operator: run.ts (the one door), prompts, guardrails, planner, scorecard writer, analyst
src/lib/jobs/       scheduled jobs (schedule.ts is pure; cron.ts runs them)
src/middleware.ts   session refresh and the signed-out redirect (must live in src/)
supabase/migrations database
supabase/tests      RLS and business-rule tests
seed/               reference data (JSON)
scripts/            seed, migration build, scratch DB rebuild
```

## Notes

- The repository's older static prototype files (`index.html`, `styles.css`, `config.js`, and `app.js`, `content.js`, `seed.js`, `store.js`, `util.js` in `src/`) are still present on this branch and are unused by the app. They remain untouched on `main`. Vercel's build prints one harmless lint warning about `src/app.js`; deleting the prototype files removes it.
- No `package-lock.json` is committed yet. Direct dependencies are pinned to exact versions in `package.json`.
