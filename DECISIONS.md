# Decisions

A running log of choices made while building, and why. Newest sections last. Anything marked **Open** needs Akshay's call.

## Milestone 0

### Setup

- **Branch `v2`, not `main`.** The repository already holds an older static prototype. All work is on `v2`; `main` was never touched. The old static files (`index.html`, `styles.css`, `config.js`) are still on `v2` and are unused by the app. Delete them when v2 replaces main.
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
  - `authenticated_security_definer_function_executable` (39): this is the write path by design. Each function checks the caller's role before doing anything. Helper functions that should not be called by clients are not granted to `authenticated`.
  - `unused_index`: a new database with no traffic yet.
- **Test coverage:** 272 assertions in `supabase/tests/rls.sql` cover every role. They ran green on a local Postgres 16 copy, and the same migrations were checked byte-for-byte against the live project (Postgres 17).

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
- **The docs disagree about Did You Know limits.** The database does not enforce "one Did You Know per conversation". **Open:** decide and, if wanted, enforce it in the Check screen (M1).
- **Measurement integrity:** every opportunity created from a log keeps `source_action_id`; the scorecard has no closed-revenue field; participation counts the whole roster including people who logged nothing; the participation rule is `actions >= least(5, weekly target)` with a target above zero.
- **Conversion rates stay hidden until programme week 12** (`programme_week()` exists; the rates arrive in M2).

### Models

- All 12 OpenRouter model slugs in the seed were checked against OpenRouter's catalogue; none needed changing.

### Housekeeping

- A `postcss` override pins the patched version so `npm audit` is clean for Next 15.
- Local tests run on Postgres 16 while Supabase runs 17; the fingerprint script (`scripts/fingerprint.sql`) confirmed the schemas are identical.
