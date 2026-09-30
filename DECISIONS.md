# Decisions

A running log of choices made while building, and why. Newest sections last. Anything marked **Open** needs Akshay's call.

## Milestone 0

### Setup

- **Branch `v2`, not `main`.** The repository already holds an older static prototype. All work is on `v2`; `main` was never touched. The old static files (`index.html`, `styles.css`, `config.js`, and `app.js`, `content.js`, `seed.js`, `store.js`, `util.js` in `src/`) are still on `v2` and are unused by the app. Delete them when v2 replaces main.
- **New Vercel project `outgrow-console-app`.** The old `outgrow-console` Vercel project is left as it was.
- **New Supabase project.** The unused `brandframe` project was deleted and replaced (its data was backed up first; RLS was off on it). The other Supabase project (`janwi-ai-prod`) was never touched.
- **Free plans on purpose.** Vercel Hobby and Supabase Free, per Akshay, for a proof of concept. Consequences are in `LIMITATIONS.md`.
- **Vercel functions run in Mumbai (`bom1`)**, next to the Supabase database (ap-south-1), so each page's database round trips stay short.
- **Exact dependency versions and Node 22.** No lockfile is committed yet (see `LIMITATIONS.md`).
- **Publishable Supabase key** (`sb_publishable_…`) is used in the browser; the secret key stays server-only in Vercel.

### Security model

- **Default-deny.** RLS is on for every table. Tables that hold mixed sensitivity (accounts, contacts, opportunities, actions, programmes...) are read only through `*_safe` views that return `NULL` for restricted columns. Direct table reads of restricted columns are not granted.
- **All business writes go through `SECURITY DEFINER` functions**, each re-checking the caller's role, with `search_path` pinned to empty.
- **Roles are read from the database on every request**, not stored in the login token, so deactivating someone takes effect immediately.
- **One admin, identified by email** (`app_settings.admin_email`, set from `ADMIN_EMAIL`). The admin does not need to be on the roster and cannot log conversations unless also added as an employee.
- **Sign-up gate** is a Before User Created hook: only the admin email or an active roster email can ever create an account. An optional email-domain check sits on top.
- **Supabase advisor findings we knowingly keep:**
  - `security_definer_view` (10): the `*_safe` views must run with owner rights to mask columns; they are `security_barrier` and filter by the caller's role.
  - `rls_enabled_no_policy` (9): those tables are deliberately unreadable by clients; only server-side functions touch them.
  - `authenticated_security_definer_function_executable` (43): this is the write path by design. Each function checks the caller's role before doing anything. Helper functions that should not be called by clients are not granted to `authenticated`. (It was 39 after M1; M2 added the AI dashboard, cost, acceptance and planner functions.)
  - `auth_leaked_password_protection`: Supabase documents this as a Pro-plan feature, so it stays off on Free. Magic link is the primary sign-in, which limits the exposure (see `LIMITATIONS.md`).
  - `unused_index`: a new database with no traffic yet.
- **Test coverage:** 295 assertions in `supabase/tests/rls.sql` cover every role, and 99 in `supabase/tests/m2.sql` cover the M2 jobs, planner, dashboard and analyst input. Both ran green on a local Postgres 16 copy, and the same migrations were checked byte-for-byte against the live project (Postgres 17). Neither suite has been run on the live database itself.

### Auth

- **Magic link is the primary sign-in;** password is optional (Account page).
- **Two kinds of sign-in link.** Emailed links are Supabase's standard ones and must be opened in the same browser that asked for them. The admin's **Copy sign-in link** uses a token-hash route (`/auth/confirm`) that works in any browser or device, which suits sending a link over chat.
- **Email templates stay on Supabase defaults** because editing them needs a custom email sender (Free plan).
- **Invites are best effort.** If an email cannot be delivered, the admin sees which invites failed and can copy a link instead.

### Data

- **Reference data is seeded; demo data is not.** Demo accounts, contacts and people load from Admin → Data import and are flagged `is_example`. "Remove examples" deletes every flagged row and everything that depends on it (touches, actions, opportunities logged against them).
- **Demo data uses real Acsia customer names** taken from the handoff pack. It is only visible after sign-in. **Open:** confirm Acsia is happy with real customer names in a demo, or swap for fictional ones.
- **In-app notifications only.** No email or push yet.
- **Focus calendar ends March 2027** (that is where the source data ends). **Open:** extend it.
- **Marketing default weekly target is 0**, so marketing does not count toward participation unless a target is set.
- **Assignments are unique per week, person and contact**, so a person can't be given the same contact twice in one Monday plan.
- **The docs disagree about Did You Know limits.** The database does not enforce "one Did You Know per conversation". Decided in M1: the Log screen's Check step shows a **soft warning** when a conversation lists more than one, and never blocks saving. **Open:** if Acsia wants a hard limit, it is a one-line change from `warn` to `error` in `src/lib/log.ts`.
- **Measurement integrity:** every opportunity created from a log keeps `source_action_id`; the scorecard has no closed-revenue field; participation counts the whole roster including people who logged nothing; the participation rule is `actions >= least(5, weekly target)` with a target above zero.
- **Conversion rates stay hidden until programme week 12** (`programme_week()`). The database computes them (`conversion_rates()`), and only the Quarterly analyst may show them, and only once week 12 has passed.

### Models

- All 12 OpenRouter model slugs in the seed were checked against OpenRouter's catalogue; none needed changing.

### Housekeeping

- A `postcss` override pins the patched version so `npm audit` is clean for Next 15.
- Local tests run on Postgres 16 while Supabase runs 17; the fingerprint script (`scripts/fingerprint.sql`) confirmed the schemas are identical.

## Milestone 1

### Screens and data

- **"People only see approved cards" lives in the app, not in row-level security.** A Draft assignment is readable (by RLS) by the assignee, the person who assigned it, the assignee's manager and executives. Today only lists statuses `Open`, `Done`, `Partly done`, `Rolled over` and `Skipped` (`VISIBLE` in `src/lib/data/today.ts`), so a Draft never shows on the assignee's card list. **Open:** if you want the database itself to hide Drafts from assignees, that is a policy change on `assignments`.
- **"Won (all time)" on Accounts** is the sum of `estimated_value_usd` on opportunities at stage `Won`, shown only to roles that can see money. It is a stage total, not booked revenue: the scorecard has no closed-revenue field by design.
- **Library "Reject" means Retired.** Rejecting a Draft play or proof point sets it to `Retired` (kept for the record, never offered). Only Draft rows can be approved or rejected, so an approved play can't be retired by a stale click.
- **AI answers stream as plain text, not server-sent events.** The brief and Ask Outgrow routes send UTF-8 text a sentence at a time so each sentence can be checked for conversion rates and forecasts before it leaves the server. Users see it appear sentence by sentence.
- **The AI never writes a deal stage or owner.** `normalize.ts` strips those keys from anything a model produced.

### Code layout

- **The middleware must be `src/middleware.ts`.** Next.js ignores it at the project root when the app lives in `src/`.
- **Pure logic is kept apart from server-only modules** (`*-core.ts`, `schedule.ts`) so Vitest can import it. Modules marked `server-only` can't be loaded in tests.

## Milestone 2

### The operator's jobs

- **Nine AI jobs, one door.** Every model call goes through `runJob()` or `streamJob()` in `src/lib/operator/run.ts`. Order: key present, job switched on, per-person rate limit, monthly budget, then the primary model and a fallback. One `ai_runs` row is written per call.
- **Rate limits:** 10 a minute and 200 a day per person, for person-triggered jobs only. Cron runs are not counted against anyone.
- **Budget:** an in-app alert goes to leaders once a month at 80% of `AI_MONTHLY_BUDGET_USD` (default 150). At 100% the operator stops and the plain forms keep working.
- **Every AI draft is re-checked in code.** Rules the model is told are also enforced after it answers, and again in the database for assignments. A draft that breaks a rule is dropped, not repaired.

### Monday planner

- **Two planners in one.** The AI proposes assignments; code validates every row (real person, a real line to the contact, no duplicates, weekly quota, nothing Acsia doesn't offer, no email, no blocked channel, no conversion rates or forecasts). A plain-rules planner then tops people up to their minimum. With no AI key, or once the budget is spent, the rules planner runs alone.
- **Quotas:** 1 to 3 assignments a week for delivery people, 4 to 6 for AEs and SDRs. The rules planner aims for 2 and 5.
- **Drafts are "from" the assignee's manager,** else the first active leader, else the person themselves (the column is required). Managers approve; nothing reaches an assignee's Today until approved.
- **Redraft replaces only the operator's own Draft rows.** Anything a manager wrote or already approved stays.
- **List rules implemented:** L01, L02, L03, L04, L05, L09, A1, A3. **Deferred:** L06 to L08, A2, L10.
- **Assumption to confirm: SDRs can be assigned contacts on L05, L09 and A1 without a named link,** because those lists are re-engagement and coverage work. Everyone else needs a named link to the contact. **Open:** confirm with Acsia.

### Friday scorecard draft

- **The Friday job first freezes the week's numbers,** so the leader comments on fixed figures, then writes the draft. Publishing stays the leader's decision.
- **The draft is exactly two sentences naming two to three people by first name, and a story line of at most 40 words.** Only first names that are unique on the roster and belong to people with activity can be named. No money, revenue, conversion rates, forecasts or things Acsia doesn't offer. If the model's draft fails any check, a plain-facts draft built from the week's own numbers replaces it; if fewer than two people did anything, no draft is written.
- **"Accepted" means the leader clicked "Use this draft",** not that they published it unedited. That is what the Operator screen's acceptance rate counts. For the planner, a run counts as accepted when at least half of its drafts are kept once all are decided.

### Quarterly analyst

- **The database computes every rate; the model only writes words.** Any sentence quoting a percentage the database did not produce, an amount of money or a forecast is removed before anyone sees it. The whole job is skipped until programme week 12.

### Scheduled jobs

- **Four jobs:** daily refresh (06:00 IST), Monday plan (07:00), Friday scorecard draft (14:00), monthly quarterly review. On Hobby each may fire up to about an hour late and only on the production deployment (see `LIMITATIONS.md`).
- **Each run is idempotent per period.** The period is an Asia/Kolkata day, a Monday-start week or a month, claimed in `job_runs`. A run that dies part-way can be taken over after 15 minutes.
- **`/api/cron/*` is public in the middleware and protected by its own bearer check.** Without `CRON_SECRET` set it answers 503, with a wrong secret 401, and never runs anything.
- **Leaders can run a job now** from the Operator screen. That deliberately re-runs the current period (a scheduled run never repeats a period unless the earlier one failed or stalled). Re-running the Monday plan is safe because Redraft only replaces the operator's own Draft rows.

### Guardrails

- **"Why?" on a Log warning** asks the operator to put a rule that already fired into plain words. It explains only; it can't change what was flagged. With the AI off or over budget, fixed wording is shown instead.

### Database changes

- **0015** jobs, list-membership refresh, conversion rates. **0016** planner saving and approval, AI acceptance, the AI dashboard. **0017** the analyst's input (91-day window, rates unlocked flag, rates per action code, opportunities by stage). Each is applied to the live project and to the local scratch copy.
