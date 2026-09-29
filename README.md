# Outgrow Console

Acsia's internal app for running the **Outgrow** method (proactive, permissioned selling inside existing customer accounts). One admin, invite-only employees, role-aware screens, and a data model that never shows revenue, pipeline values or competitor names to delivery engineers.

> **Status: Milestone 0 (foundation).** Sign-in, roles, admin (employees, settings, data import, audit), the full database with row-level security, and the app shell are built and deployed. The Log / Prep / Ask sheets, Today, Accounts, Team, Scorecard, Library and the AI operator arrive in Milestones 1 and 2. Screens not built yet show a "coming next" page. See `LIMITATIONS.md` and `DECISIONS.md`.

## Stack

Next.js 15 (App Router, TypeScript strict) on Vercel · Supabase (Postgres, Auth, RLS) · Tailwind CSS 4 + Radix · zod at every boundary · server components and server actions · OpenRouter for AI (server-side only, from M1).

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
| `OPENROUTER_API_KEY` | **Server only**, used from M1 | **Yes** |
| `AI_MONTHLY_BUDGET_USD` | AI spend alert threshold | No |
| `CRON_SECRET` | Protects `/api/cron/*` (Vercel sends it as a Bearer token) | **Yes** |

## Database

Everything lives in `supabase/migrations/` (0001 to 0012) and is applied in order.

- **Default-deny.** Every table has RLS on. Business writes only go through `SECURITY DEFINER` functions (`log_conversation`, `create_assignment`, and so on) that re-check the caller's role.
- **Roles come from the database on every request** (`get_me()`), never from a token claim.
- **Mixed tables** (accounts, contacts, opportunities, actions...) are read through `*_safe` views that return `NULL` for restricted columns, so a delivery engineer's API calls physically cannot return revenue, pipeline values or competitor names.
- **Sign-up gate.** The Before User Created hook (`public.hook_before_user_created`) rejects anyone not on the roster (or not the admin).

### Tests

`supabase/tests/rls.sql` is one pure-SQL file: 272 assertions across every role (anonymous, stranger, engineer, PM, delivery lead, AE, SDR, pre-sales, leader, CEO, admin), the log-a-conversation rules, the sign-up gate, scorecard rules and "remove examples". It runs in a single transaction that always rolls back, so it is safe to run repeatedly.

```bash
# Local Postgres (uses a stub of Supabase's auth schema in supabase/tests/00_stub_supabase.sql)
npm run test:rls
```

A passing run prints `RLS_TESTS_PASSED <n> assertions`. Do not run this against a database that holds real data unless you understand it rolls back; it creates fixtures inside its transaction.

### Seed (reference data only)

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_EMAIL=... npm run seed
```

Idempotent. It loads the library (service lines, plays, picklists, action codes, channel rules, focus calendar, list definitions, AI routes) and sets the admin email. Demo accounts and people are **never** seeded; the admin loads them from **Admin → Data import**, and removes them with one click.

## Deploying

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order.
2. Supabase → Authentication → **Hooks** → enable **Before User Created** → Postgres function `public.hook_before_user_created`.
3. Supabase → Authentication → **URL Configuration** → set Site URL to the app URL and add `<app URL>/**` to Redirect URLs.
4. Create a Vercel project from this repo (branch `v2`) and set the environment variables above.
5. Sign in as the admin, open **Admin → Data import → Load library**, add employees under **Admin → Employees**.
6. Before inviting real employees, set up custom SMTP in Supabase (Authentication → Emails → SMTP Settings). On the Free plan the built-in mailer only reaches Supabase team members; until then use **Copy sign-in link** on the Employees screen.

## Layout

```
src/app/            routes (login, auth/*, welcome, (app)/* signed-in screens)
src/components/     shell, sheets, ui
src/lib/            env, roles, dates, outgrow rules, import, seeds, supabase clients
supabase/migrations database
supabase/tests      RLS and business-rule tests
seed/               reference data (JSON)
scripts/            seed, migration build, scratch DB rebuild
```

## Notes

- The repository's older static prototype files (`index.html`, `styles.css`, `config.js`) are still present on this branch and are unused by the app. They remain untouched on `main`.
- No `package-lock.json` is committed yet. Direct dependencies are pinned to exact versions in `package.json`.
