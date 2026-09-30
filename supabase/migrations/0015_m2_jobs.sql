-- Milestone 2: scheduled jobs and the operator's bookkeeping.
--   * nightly refresh of stored derived fields + "who to call" list membership (docs/01 §5, docs/05)
--   * cron idempotency (claim/finish a job_runs row atomically)
--   * planner drafts remember which AI run produced them (so acceptance can be recorded)
--   * Friday scorecard: the operator's draft is kept next to the week, visible to exec only
--   * conversion rates: locked until programme week 12 (PRD principle 7), plus the analyst's aggregate input
-- Everything the cron calls is service_role only. Nothing here gives a browser a new way in.

------------------------------------------------------------------ columns
alter table public.assignments add column if not exists ai_run_id uuid references public.ai_runs (id) on delete set null;
create index if not exists assignments_ai_run_idx on public.assignments (ai_run_id) where ai_run_id is not null;

alter table public.scorecard_weeks add column if not exists ai_draft jsonb;

create or replace view public.scorecard_weeks_safe with (security_barrier = true) as
select s.week_id, s.week_start, s.status, s.ceo_commentary, s.named_person_ids, s.total_actions, s.participation_rate, s.proposals_raised, s.opps_created,
       s.followups_made,
       case when (select public.can_see_money()) then s.est_value_surfaced_usd end as est_value_surfaced_usd,
       s.featured_story_ids, s.featured_testimonial_id, s.published_at, s.is_example,
       case when (select public.is_exec()) then s.ai_draft end as ai_draft
from public.scorecard_weeks s
where s.archived_at is null and (select public.is_employee()) and (s.status = 'Published' or (select public.is_exec()));

------------------------------------------------------------------ cron idempotency
-- True when THIS caller now owns (job, period). A finished (ok / skipped) period is never claimed twice; a failed one, or one that
-- has been "running" for over 15 minutes (the function died), can be taken over. p_force is for the Operator screen's "Run now".
create or replace function public.claim_job_run(p_job text, p_period text, p_force boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare got int;
begin
  insert into public.job_runs as jr (job, period_key, status) values (p_job, p_period, 'running')
  on conflict (job, period_key) do update set status = 'running', started_at = now(), finished_at = null, detail = null
    where p_force or jr.status = 'error' or (jr.status = 'running' and jr.started_at < now() - interval '15 minutes');
  get diagnostics got = row_count;
  return got > 0;
end $$;

create or replace function public.finish_job_run(p_job text, p_period text, p_status text, p_detail jsonb default null) returns void
language sql security definer set search_path = '' as $$
  update public.job_runs set status = p_status, finished_at = now(), detail = p_detail where job = p_job and period_key = p_period $$;

------------------------------------------------------------------ nightly: stored derived fields
-- Days-since numbers are computed live in the *_safe views. What IS stored, and must be refreshed, is: service lines bought,
-- contacts mapped, coverage, single-thread risk, and each contact's next-touch date. Tier and revenue trend come from the
-- finance feed (M3) and are left alone. Stale insights are marked, never deleted.
create or replace function public.refresh_derived() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.today_ist(); n_acc int; n_con int; n_ins int;
begin
  with s as (
    select a.account_id, x.slb, x.cm,
           case when coalesce(a.buying_committee_est, 0) > 0 then least(1::numeric, round(x.cm::numeric / a.buying_committee_est, 4)) end as cov
    from public.accounts a
    cross join lateral (select
      (select count(*)::int from public.whitespace_map w where w.account_id = a.account_id and w.status = 'Buying from Acsia' and w.archived_at is null) as slb,
      (select count(*)::int from public.contacts c where c.account_id = a.account_id and c.contact_status = 'Active' and c.archived_at is null) as cm) x
    where a.archived_at is null)
  update public.accounts a set service_lines_bought = s.slb, contacts_mapped = s.cm, coverage_ratio = s.cov
  from s
  where s.account_id = a.account_id
    and (a.service_lines_bought is distinct from s.slb or a.contacts_mapped is distinct from s.cm or a.coverage_ratio is distinct from s.cov);
  get diagnostics n_acc = row_count;

  with s as (
    select c.contact_id,
           (select a.contacts_mapped <= 1 from public.accounts a where a.account_id = c.account_id) as single,
           case when c.touch_cadence_days is null then null
                else coalesce((c.last_proactive_touch_at at time zone 'Asia/Kolkata')::date, v_today) + c.touch_cadence_days end as due
    from public.contacts c where c.archived_at is null and c.contact_status = 'Active')
  update public.contacts c set single_thread_risk = s.single, next_touch_due = s.due
  from s
  where s.contact_id = c.contact_id and (c.single_thread_risk is distinct from s.single or c.next_touch_due is distinct from s.due);
  get diagnostics n_con = row_count;

  update public.insights set status = 'Stale'
  where status = 'Open' and relevant_until is not null and relevant_until < v_today and archived_at is null;
  get diagnostics n_ins = row_count;

  return jsonb_build_object('accounts_updated', n_acc, 'contacts_updated', n_con, 'insights_marked_stale', n_ins);
end $$;

------------------------------------------------------------------ nightly: who to call (list membership)
-- The rule text in list_definitions is for humans; the rule itself lives here, keyed by list id. Only lists marked active are
-- computed. Finance-dependent lists (L06 Decreasing, L07 Autopilot, L08 Stopped) and the milestone list (A2) arrive with M3, and
-- L10 (cold prospects) is out of scope by design, so they produce no members.
create or replace function public._list_candidates()
returns table (list_id text, account_id uuid, contact_id uuid, opportunity_id uuid, reason text)
language sql stable security definer set search_path = '' as $$
  with act as (select d.list_id from public.list_definitions d where d.active and d.archived_at is null),
       t as (select public.today_ist() as d)
  -- L01 Quotes & proposals outstanding
  select 'L01'::text, o.account_id,
         coalesce(o.primary_contact_id, (select c.contact_id from public.contacts c where c.account_id = o.account_id and c.contact_status = 'Active' and c.archived_at is null
                                          order by c.relationship_strength desc nulls last, c.contact_id limit 1)),
         o.opportunity_id, ('Proposal out ' || (t.d - o.proposal_sent_date) || ' days, no follow-up in 14 days')::text
  from public.opportunities o, t
  where exists (select 1 from act where act.list_id = 'L01') and o.archived_at is null and o.stage in ('Proposal sent', 'Negotiation')
    and o.proposal_sent_date is not null and t.d - o.proposal_sent_date > 56
    and not exists (select 1 from public.actions a where a.opportunity_id = o.opportunity_id and a.action_code = 'OG2.3' and a.archived_at is null and a.action_date >= t.d - 14)
  union all
  -- L02 Pre-quote, stalled before a proposal
  select 'L02', o.account_id,
         coalesce(o.primary_contact_id, (select c.contact_id from public.contacts c where c.account_id = o.account_id and c.contact_status = 'Active' and c.archived_at is null
                                          order by c.relationship_strength desc nulls last, c.contact_id limit 1)),
         o.opportunity_id, 'Stuck before a proposal for ' || (t.d - (o.stage_changed_at at time zone 'Asia/Kolkata')::date) || ' days'
  from public.opportunities o, t
  where exists (select 1 from act where act.list_id = 'L02') and o.archived_at is null and o.stage in ('Identified', 'Qualifying', 'Pre-proposal')
    and o.proposal_sent_date is null and t.d - (o.stage_changed_at at time zone 'Asia/Kolkata')::date > 30
  union all
  -- L03 Large accounts that can buy more (tier A/B, at most 2 service lines): warm, senior contacts
  select 'L03', c.account_id, c.contact_id, null::uuid, 'Tier ' || left(a.tier, 1) || ' account using ' || coalesce(a.service_lines_bought, 0) || ' of 15 service lines'
  from public.contacts c join public.accounts a on a.account_id = c.account_id
  where exists (select 1 from act where act.list_id = 'L03') and c.archived_at is null and a.archived_at is null and c.contact_status = 'Active'
    and left(a.tier, 1) in ('A', 'B') and coalesce(a.service_lines_bought, 0) <= 2
    and coalesce(c.relationship_strength, 0) >= 3 and c.seniority in ('C-level', 'VP', 'Director', 'Head of', 'Manager')
  union all
  -- L04 Small / medium accounts that can buy more (two warmest contacts per account)
  select 'L04', x.account_id, x.contact_id, null::uuid, 'Smaller account that could buy more'
  from (select c.account_id, c.contact_id,
               row_number() over (partition by c.account_id order by c.relationship_strength desc nulls last, c.contact_id) as rn
        from public.contacts c join public.accounts a on a.account_id = c.account_id
        where c.archived_at is null and a.archived_at is null and c.contact_status = 'Active' and left(a.tier, 1) = 'C' and a.customer_status = 'Active') x
  where exists (select 1 from act where act.list_id = 'L04') and x.rn <= 2
  union all
  -- L05 Zero Dark 30 / silent 6+ months: nobody has made a proactive call in over 30 days
  select 'L05', c.account_id, c.contact_id, null::uuid,
         case when c.last_proactive_touch_at is null then 'No proactive call yet'
              when t.d - (c.last_proactive_touch_at at time zone 'Asia/Kolkata')::date > 180 then 'Silent 6+ months'
              else 'Silent ' || (t.d - (c.last_proactive_touch_at at time zone 'Asia/Kolkata')::date) || ' days' end
  from public.contacts c join public.accounts a on a.account_id = c.account_id, t
  where exists (select 1 from act where act.list_id = 'L05') and c.archived_at is null and a.archived_at is null and c.contact_status = 'Active'
    and a.track = 'EXPAND' and coalesce(c.relationship_strength, 0) >= 2
    and (c.last_proactive_touch_at is null or t.d - (c.last_proactive_touch_at at time zone 'Asia/Kolkata')::date > 30)
  union all
  -- L09 Warm prospects who did not buy (lost or parked on timing / no decision / price in the last 18 months)
  select 'L09', o.account_id, o.primary_contact_id, o.opportunity_id, 'Lost on ' || o.lost_reason || ', worth another look'
  from public.opportunities o join public.contacts pc on pc.contact_id = o.primary_contact_id, t
  where exists (select 1 from act where act.list_id = 'L09') and o.archived_at is null and o.stage in ('Lost', 'Parked')
    and o.lost_reason in ('Timing', 'No decision', 'Price')
    and coalesce(o.closed_date, (o.stage_changed_at at time zone 'Asia/Kolkata')::date) >= t.d - 548
    and pc.sentiment in ('Advocate', 'Positive', 'Neutral') and pc.contact_status = 'Active'
  union all
  -- A1 Single-threaded accounts: coverage under 10% of the buying group, so reach the warmest people there
  select 'A1', c.account_id, c.contact_id, null::uuid, 'Only ' || round(a.coverage_ratio * 100)::int || '% of the buying group is mapped'
  from public.contacts c join public.accounts a on a.account_id = c.account_id
  where exists (select 1 from act where act.list_id = 'A1') and c.archived_at is null and a.archived_at is null and c.contact_status = 'Active'
    and left(a.tier, 1) in ('A', 'B', 'C') and a.coverage_ratio < 0.10 and coalesce(c.relationship_strength, 0) >= 3
  union all
  -- A3 Renewal window: an active programme renews within 90 days, so call the customer lead
  select 'A3', p.contracting_account_id, p.customer_lead_contact_id, null::uuid, 'Renewal in ' || (p.renewal_date - t.d) || ' days'
  from public.programmes p, t
  where exists (select 1 from act where act.list_id = 'A3') and p.archived_at is null and p.status = 'Active' and p.customer_lead_contact_id is not null
    and p.renewal_date between t.d and t.d + 90 $$;

create or replace function public.refresh_list_memberships() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.today_ist(); v_week date := public.week_start_of(public.today_ist()); n_add int; n_exit int; n_open int;
        zero constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  drop table if exists pg_temp._cand;
  create temp table _cand on commit drop as
    select distinct on (u.list_id, u.account_id, coalesce(u.contact_id, zero), coalesce(u.opportunity_id, zero)) u.*
    from public._list_candidates() u
    where u.contact_id is not null or u.opportunity_id is not null
    order by u.list_id, u.account_id, coalesce(u.contact_id, zero), coalesce(u.opportunity_id, zero);

  update public.list_memberships m set exited_at = v_today
  where m.exited_at is null and m.archived_at is null
    and not exists (select 1 from _cand c where c.list_id = m.list_id and c.account_id = m.account_id
                    and c.contact_id is not distinct from m.contact_id and c.opportunity_id is not distinct from m.opportunity_id);
  get diagnostics n_exit = row_count;

  insert into public.list_memberships (list_id, account_id, contact_id, opportunity_id, reason, entered_at, is_example)
  select c.list_id, c.account_id, c.contact_id, c.opportunity_id, c.reason, v_today,
         coalesce((select a.is_example from public.accounts a where a.account_id = c.account_id), false)
  from _cand c
  where not exists (select 1 from public.list_memberships m where m.exited_at is null and m.archived_at is null and m.list_id = c.list_id and m.account_id = c.account_id
                    and m.contact_id is not distinct from c.contact_id and m.opportunity_id is not distinct from c.opportunity_id);
  get diagnostics n_add = row_count;

  update public.list_memberships m set reason = c.reason
  from _cand c
  where m.exited_at is null and m.archived_at is null and c.list_id = m.list_id and c.account_id = m.account_id
    and c.contact_id is not distinct from m.contact_id and c.opportunity_id is not distinct from m.opportunity_id and m.reason is distinct from c.reason;

  update public.list_memberships m set assigned_this_week = x.asg
  from (select m2.membership_id, exists (
          select 1 from public.assignments a
          where a.week_start = v_week and a.status <> 'Dropped' and a.archived_at is null
            and ((m2.contact_id is not null and a.contact_id = m2.contact_id) or (m2.opportunity_id is not null and a.opportunity_id = m2.opportunity_id))) as asg
        from public.list_memberships m2 where m2.exited_at is null and m2.archived_at is null) x
  where x.membership_id = m.membership_id and m.assigned_this_week is distinct from x.asg;

  select count(*) into n_open from public.list_memberships where exited_at is null and archived_at is null;
  return jsonb_build_object('added', n_add, 'exited', n_exit, 'open', n_open);
end $$;

------------------------------------------------------------------ measurement: conversion rates unlock in week 12
-- One row per action code: how many actions, how many opportunities trace back to them (source_action_id), and the rate.
-- Below 30 actions the rate is withheld ("not enough data"). Before programme week 12 the whole function refuses.
create or replace function public.conversion_rates()
returns table (action_code text, actions bigint, opportunities bigint, rate numeric, enough_data boolean)
language plpgsql stable security definer set search_path = '' as $$
declare wk int := public.programme_week();
begin
  if not public.is_exec() then raise exception 'NOT_ALLOWED: conversion rates are for the Outgrow leader, CEO and admin' using errcode = '42501'; end if;
  if wk < 12 then raise exception 'LOCKED: conversion rates unlock in programme week 12 (this is week %)', wk using errcode = 'P0001'; end if;
  return query
  select a.action_code, count(*)::bigint,
         (count(o.opportunity_id))::bigint,
         case when count(*) >= 30 then round(count(o.opportunity_id)::numeric / count(*), 4) end,
         count(*) >= 30
  from public.actions a
  left join public.opportunities o on o.source_action_id = a.action_id and o.origin = 'Outgrow action' and o.archived_at is null
  where a.archived_at is null and not a.is_example and a.action_code <> 'OG0.1'
  group by a.action_code order by a.action_code;
end $$;

-- What the quarterly analyst is allowed to see: counts only, no money, no names. Service role only.
create or replace function public.analyst_input() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'programme_week', public.programme_week(),
    'actions_by_code', coalesce((select jsonb_agg(jsonb_build_object('code', g.action_code, 'actions', g.n) order by g.action_code)
                                 from (select a.action_code, count(*)::int n from public.actions a
                                       where a.archived_at is null and not a.is_example and a.action_date >= public.today_ist() - 91 group by a.action_code) g), '[]'::jsonb),
    'opportunities_by_source_code_and_stage', coalesce((select jsonb_agg(jsonb_build_object('code', g.action_code, 'stage', g.stage, 'count', g.n) order by g.action_code, g.stage)
                                 from (select a.action_code, o.stage, count(*)::int n from public.opportunities o join public.actions a on a.action_id = o.source_action_id
                                       where o.archived_at is null and not o.is_example and o.origin = 'Outgrow action' group by a.action_code, o.stage) g), '[]'::jsonb),
    'participation_by_week', coalesce((select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'participation_rate', w.participation_rate, 'total_actions', w.total_actions) order by w.week_start)
                                 from (select week_start, participation_rate, total_actions from public.scorecard_weeks
                                       where archived_at is null and not is_example and status = 'Published' order by week_start desc limit 13) w), '[]'::jsonb),
    'new_service_lines_bought_last_90_days', (select count(*)::int from public.whitespace_map w
                                       where w.status = 'Buying from Acsia' and w.archived_at is null and not w.is_example and w.created_at >= now() - interval '90 days')
  ) $$;

------------------------------------------------------------------ grants
revoke execute on function public.claim_job_run(text, text, boolean), public.finish_job_run(text, text, text, jsonb), public.refresh_derived(),
  public._list_candidates(), public.refresh_list_memberships(), public.analyst_input(), public.conversion_rates()
  from public, anon, authenticated;
grant execute on function public.claim_job_run(text, text, boolean), public.finish_job_run(text, text, text, jsonb), public.refresh_derived(),
  public._list_candidates(), public.refresh_list_memberships(), public.analyst_input() to service_role;
grant execute on function public.freeze_week(date) to service_role;
grant execute on function public.conversion_rates() to authenticated, service_role;
