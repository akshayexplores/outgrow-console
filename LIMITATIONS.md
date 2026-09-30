# Limitations of this proof of concept

This build runs on **Vercel Hobby (free)** and **Supabase Free**, by choice, to show a working prototype before paying for anything. These are the things the free plans limit, what each means in practice, and what upgrading fixes.

## Vercel Hobby

| Limit | What it means here | Fix |
|---|---|---|
| **Non-commercial use only** (Vercel's terms) | Fine for a demo to Acsia. Not allowed for real day-to-day company use. | Vercel Pro before real use |
| **Cron: once per day, timing within about an hour** | The plan needs Monday 07:00, Friday 14:00, daily 06:00 and monthly jobs. Each job here runs at most once per day, so they are allowed, but they can fire up to about 59 minutes late. | Pro gives per-minute precision |
| **Crons run only on the production deployment** | Preview deployments never run scheduled jobs. | Deploy to production |
| **Scheduled jobs are built but not yet seen running on Vercel** | The four cron routes exist and refuse callers without the secret. Checked locally for all four, and on the live site for `/api/cron/daily` (answers 401, JSON, nothing runs). `CRON_SECRET` is set on the Vercel project (the name was checked, never the value). The first real scheduled run happens at the next scheduled time on the production deployment. Until then, Operator → **Run now** does the same work by hand. | Watch the first runs on the Operator screen |
| **Production Branch is still `main`** | Vercel only runs crons on the production deployment and builds production from the Production Branch. The app lives on `v2`, so production deploys are made by hand for now. | Set the Production Branch to `v2` (Vercel → Settings → Git) |
| **Function time limit** | The scheduled-job route asks for up to 300 s and Vercel accepted that setting when it built on Hobby. No job has yet run for anywhere near that long here, so whether a slow Monday plan finishes inside the limit on Hobby is untested. The AI answer routes ask for 60 s. | Pro raises the ceiling |
| **Logs kept about 1 hour** | Hard to investigate something that broke yesterday. | Pro keeps longer |
| **100 deployments per day** | Not a concern day to day. | Pro |
| **Public link, no extra password layer** | Anyone with the link can load the sign-in page. Data stays protected by sign-in and the database rules, but you cannot hide the site itself behind a password. | Pro (deployment password protection) |

## Supabase Free

| Limit | What it means here | Fix |
|---|---|---|
| **Project auto-pauses after 7 days without activity** | If nobody opens the app for a week, the first visit fails until the project is restored from the Supabase dashboard (about a minute). Bad look for a demo after a quiet week. | Supabase Pro |
| **No backups or point-in-time recovery** | If data is deleted or corrupted it cannot be restored. Demo data only for now. | Pro (daily backups; PITR is an add-on) |
| **Emails only reach team members** | The free built-in email service only delivers to people who are members of the Supabase organisation. Invites and sign-in links to other Acsia employees will not arrive. Also limited to a few emails per hour. | Set up your own email sender (Resend, Postmark, SES) in Supabase → Auth → SMTP |
| **Workaround in the app** | Admin → Employees → **Copy sign-in link** produces a one-time link you send yourself (WhatsApp, Teams). | none needed for the demo |
| **Email templates cannot be edited** | Editing the invite and sign-in email wording requires your own email sender. The default Supabase wording is used. | Same as above |
| **500 MB database, 1 GB file storage, 5 GB traffic per month** | Plenty for a pilot with demo data. | Pro |
| **Two free projects per account** | This project counts toward the limit. | Pro |
| **Sign-up hook and rate limits** | Works on Free. The sign-in email rate limit is low, so several people signing in within minutes may be told to wait. | Custom email sender raises it |
| **Leaked-password protection is Pro only** | Supabase's own advisor flags it as off. Magic link is the main way in and passwords are optional, so the exposure is small, but anyone who sets a password is not checked against known leaked ones. | Supabase Pro |

## Not built

- **Milestone 3 items** (finance feed for tier and revenue trend, and the rest of that milestone).
- **Email or push notifications.** Notifications are in-app only.
- **Some list rules.** The Monday planner and who-to-call lists implement L01, L02, L03, L04, L05, L09, A1 and A3. L06 to L08, A2 and L10 are deferred.

## Checked on the live site (30 September 2026)

- The `v2` branch built on Vercel and is the production deployment. The build finished cleanly. The one warning I saw in the end of the build log was a lint warning about an old prototype file (`src/app.js`) that is not part of the app.
- `/api/cron/daily` answers a caller without the secret with a JSON 401. `/operator` sends a signed-out visitor to the sign-in page. Vercel's error log was empty when I checked a few minutes after the deploy, which says little because almost nobody had used the site yet.
- Two accounts exist on the live project: the admin and one employee added from the roster, both of whom have signed in. So sign-in works for real people, not only in tests.
- The Supabase security advisor was re-run. It lists only the findings already recorded in `DECISIONS.md` (plus the Pro-only leaked-password warning above).

## Not yet tested against real services

Everything below passed only in the sandbox (local Postgres 16, unit tests, a local production build), or has not been run at all. I would rather say so than let it read as proven.

- **The AI itself.** No OpenRouter key is set, so no live model call has ever been made. The code paths for a real answer (streaming, fallback model, schema validation, the sentence-by-sentence rate scrub) are covered by unit tests with stand-in answers, not by a real model. Until the key is added the app runs on plain forms and the rules-only planner.
- **Some sign-in routes.** Sign-in has worked live for two accounts, but I did not check which route the employee used. The "Copy sign-in link" route, re-invites, password sign-in and the sign-up gate turning a stranger away have not been used on the live project. The gate and every row-level rule are tested in SQL.
- **The library.** At the time of the last check the reference library (plays, service lines, AI job settings) had not yet been loaded on the live project, so the Library, Operator and planner screens are empty until **Admin → Data import → Load library** is run.
- **The signed-in screens in a browser.** The signed-in Playwright specs have never run, because that needs test users in a separate staging project. The signed-out surface (redirects, `/admin` not revealing itself, JSON 401 on the AI and cron endpoints, security headers, the login page on phone width) has 24 passing checks.
- **The database tests on the live database.** `rls.sql` (295 assertions) and `m2.sql` (99) ran on a local copy. The live project has the same migrations applied, verified against the local schema, but the suites themselves have not been run there.
- **Speed and accessibility targets.** The 95 accessibility score and 1.5 second p95 have not been measured. Only the login page's first load and labelling are checked.

## Behaviours to know

- **The rules-only planner takes over** when there is no AI key or the month's budget is spent. It follows the same rules and quotas but writes plain instructions, so drafts read more generically.
- **SDRs are assumed able to reach L05, L09 and A1 contacts** without a named link, because those lists are re-engagement work. Everyone else needs a named link. Confirm this with Acsia.
- **"Accepted" on the Operator screen means "used".** A scorecard draft counts when the leader clicks "Use this draft" (not only if published unedited). Planner runs count when at least half their drafts are kept.
- **AI answers appear a sentence at a time,** not word by word. Each sentence is checked for conversion rates and forecasts before it leaves the server.
- **Library "Reject" retires** the play or proof point rather than deleting it.
- **Conversion rates stay hidden until programme week 12,** everywhere including the scorecard, which never shows closed revenue.

## Other honest caveats

- **OpenRouter key not set yet.** Add `OPENROUTER_API_KEY` in Vercel (Settings → Environment Variables, Production), then redeploy. Set it to a key with a spending cap of its own; the app's own cap is `AI_MONTHLY_BUDGET_USD` (default 150).
- **No lockfile committed.** A `package-lock.json` exists in the working copy but was too large to push through the tool used here, so Vercel installs from the exact versions pinned in `package.json`. Sub-dependencies are resolved fresh on each build. Committing the lockfile is a one-command fix from a normal machine.
- **The demo data uses real Acsia customer names.** It is only visible after sign-in and is flagged `is_example`, so **Admin → Data import → Remove examples** deletes it all in one click.
