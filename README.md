# Outgrow Console

Operational console for running the Outgrow proactive-sales system against your organisation's **existing delivery and programme accounts**.

No build step. No framework. Static files, deployable to Vercel in about two minutes.

---

## What this is for

Most B2B sales processes run through a defined set of stages, then hand off to Delivery and stop. There is no post-sale motion. Meanwhile your own engineers sit inside customer programmes every week holding trust no salesperson could buy, next to spend nobody asks about.

This console runs the system that fills that gap: a small number of deliberately trivial customer-facing behaviours, done daily, tracked as **inputs** rather than outcomes.

**Scope boundary.** This holds accounts, contacts, lists, assignments and logged actions. It does **not** hold deal stage, MEDDPICC or Blue Sheet data — those stay in your CRM. Keeping that line is what stops this becoming a second source of truth.

---

## Deploy

### 1. Vercel

Import the repo at [vercel.com/new](https://vercel.com/new) — no build command, no framework preset. `vercel.json` sets the headers.

Or from the CLI:

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

### 2. Shared storage (do this before more than one person uses it)

Out of the box the app stores data in the browser (`localStorage`). That is fine for evaluating it, but the team scorecard is only meaningful when everyone writes to the same place — and participation, the number the whole system runs on, is meaningless without it.

1. Create a free project at [supabase.com](https://supabase.com)
2. Open the SQL editor and run [`supabase/schema.sql`](./supabase/schema.sql)
3. Paste your Project URL and anon/public key into [`config.js`](./config.js)
4. Redeploy

```js
window.OUTGROW_CONFIG = {
  supabaseUrl:     "https://xxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGci...",
  workspaceId:     "default"
};
```

The anon key is designed to be public and is safe in a client bundle **provided row-level security is on**, which `schema.sql` sets up. Never put the `service_role` key here.

The sidebar shows which mode you're in: *This browser only* or *Shared storage*.

---

## Layout

```
index.html            app shell
config.js             runtime config — Supabase keys go here
styles.css
src/
  content.js          THE PLAYBOOK — every script, objection, guide. Plain data, edit freely.
  seed.js             starting accounts, contacts, people. Replace with the real base.
  store.js            storage adapter — localStorage | Supabase
  util.js             helpers
  app.js              views, modals, handlers
supabase/schema.sql   one table, RLS on
vercel.json
```

**`src/content.js` is the file to edit.** Every script, objection response, interview question and channel rule lives there as plain data, so anyone on the team can change the words without touching application code. Change them there and they change everywhere — including the script that appears next to someone at the moment they're about to make the call.

---

## What's in it

**Do the work**
- **My week** — your assignments, your streak, one-click logging
- **Lists** — all ten customer lists, grouped Pipeline / Wallet share / Decay, each with its own call approach, opener, questions, pivot, voicemail and follow-up text
- **Playbook** — the eight action scripts, the three-part call, per-list scripts, objection responses for your own team and for customers, channel rules by geography, the cross-sell map, the pocket card, the cadence, the doctrine

**Run the system**
- **Assign** — Monday assignments with mechanical suggestions derived from the lists, so nobody hand-types twenty rows
- **Scorecard** — leading indicators only, participation, streaks, action mix, and the actions-per-opportunity measurement that becomes the week-12 conversion read

**Build the foundation**
- **Interviews** — Happy Customer Interview tracker with the full protocol, and a gate on the Assign screen until the target is met
- **Testimonials** — harvested automatically from interview quotes; feeds the "Testimonial Shared" action

**Signals** — the cross-account views that are invisible one account at a time: never-contacted economic buyers, single-threaded accounts, lowest wallet share.

---

## The lists

Ten of the book's eleven. Cold prospects are deliberately excluded — that list belongs to your existing outbound engine, and running it here would put two systems on the same accounts.

| Group | List | Membership |
|---|---|---|
| Pipeline | Quotes & Proposals Outstanding | manual |
| Pipeline | Pre-Quote — Nothing Sent Yet | manual |
| Pipeline | Warm — Evaluated, Didn't Buy | manual |
| Wallet share | Large Accounts Who Can Buy More | manual |
| Wallet share | Small & Medium Accounts Who Can Buy More | manual |
| Wallet share | Revenue Autopilot | manual |
| Decay | Zero Dark 30 | **derived** — 30–180 days since last touch |
| Decay | Silent 6+ Months | **derived** — over 180 days |
| Decay | Decreasing Revenue | manual (needs billing history from finance) |
| Decay | Used to Buy, Stopped | manual |

Accounts can sit on several lists. That's a feature — it means two different people have a reason to reach out.

---

## Things built in on purpose

- **Logging is three fields and states "proactive only" at the point of entry.** Every field added past that trades a real customer behaviour for a data point.
- **Managers can log on behalf of someone else.** The field pattern is: engineer asks one question on site, texts their manager from the car, manager logs it. Asking an engineer to open a CRM at a customer's office is asking them not to bother.
- **The scorecard shows no closed revenue.** Cycles can run 9–18 months. Measuring hits before the swings convert is the fastest way to kill the programme.
- **No borrowed conversion rates.** Published figures from distribution businesses (20% DYK, 80% rDYK, 25% pivot) do not transfer and appear nowhere. The tool measures your own and shows nothing until there's volume.
- **Participation below 60% triggers a leadership prompt, not a team one.** When adoption sags the cause is almost never the frontline.
- **Logging an opportunity prompts for the story immediately** — a week later, in a separate workflow, it never gets collected.

---

## Local development

ES modules need a server; `file://` won't work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Companion

An "Outgrow" coaching skill is the diagnostics and rollout-sequence layer. This console is the operational layer. They share the same source material.
