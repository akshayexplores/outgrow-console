# Limitations of this proof of concept

This build runs on **Vercel Hobby (free)** and **Supabase Free**, by choice, to show a working prototype before paying for anything. These are the things the free plans limit, what each means in practice, and what upgrading fixes.

## Vercel Hobby

| Limit | What it means here | Fix |
|---|---|---|
| **Non-commercial use only** (Vercel's terms) | Fine for a demo to Acsia. Not allowed for real day-to-day company use. | Vercel Pro before real use |
| **Cron: once per day, timing within about an hour** | The plan needs Monday 07:00, Friday 14:00, daily 06:00 and monthly jobs. Each job here runs at most once per day, so they are allowed, but they can fire up to about 59 minutes late. | Pro gives per-minute precision |
| **Crons run only on the production deployment** | Preview deployments never run scheduled jobs. | Deploy to production |
| **No cron jobs exist yet** | `vercel.json` already lists the four cron paths. The routes arrive in Milestone 2, so until then those calls return 404 (harmless). | Milestone 2 |
| **Function time limit** (300 s) | Enough for the AI jobs planned. | Pro raises it |
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

## Things not yet built (by milestone)

- **Milestone 1:** Log, Prep and Ask sheets, Today for every role, Accounts, Team (Monday plan approval), Scorecard, Library, demo-data screen polish, AI capture parsing, in-app notifications.
- **Milestone 2:** AI brief, plan, score and guard jobs, cron routes, conversion rates (hidden until programme week 12), the Operator admin screen.
- **Not planned:** email or push notifications (notifications are in-app only), Milestone 3 items.

## Other honest caveats

- **OpenRouter key not set yet.** AI features fall back to plain forms until `OPENROUTER_API_KEY` is added to Vercel (M1).
- **No lockfile committed.** Direct dependencies are pinned to exact versions, but sub-dependencies are resolved fresh on each build. Adding `package-lock.json` is a one-command fix from a normal machine.
- **The demo data uses real Acsia customer names.** It is only visible after sign-in and is flagged `is_example`, so **Admin → Data import → Remove examples** deletes it all in one click.
