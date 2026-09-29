-- Weekly stats (live), the Friday freeze and publish. Participation counts the WHOLE roster (incl. zero loggers).
-- Definitions: participated = actions >= least(5, weekly_target) and weekly_target > 0 (docs/02). No closed revenue anywhere here.

insert into public.app_settings (key, value) values ('programme_start', '') on conflict (key) do nothing;

create or replace function public.week_stats(p_week date)
returns table (person_id uuid, full_name text, job_role text, app_role text, manager_id uuid, weekly_target int, show_on_ranked_scorecard boolean,
               actions int, proactive_touches int, pct_of_target numeric, participated boolean, streak_weeks int, by_code jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare ws date := public.week_start_of(p_week); me uuid := public.current_person_id();
begin
  if not public.is_employee() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return query
  with cnt as (
    select ac.person_id, count(*)::int n, (count(*) filter (where ac.action_code = 'OG0.1'))::int p
    from public.actions ac where ac.action_date between ws and ws + 6 and ac.archived_at is null group by ac.person_id),
  bc as (
    select g.person_id, jsonb_object_agg(g.action_code, g.n) codes
    from (select ac.person_id, ac.action_code, count(*)::int n from public.actions ac
          where ac.action_date between ws and ws + 6 and ac.archived_at is null group by ac.person_id, ac.action_code) g group by g.person_id),
  prev as (
    select s.person_id, s.streak_weeks from public.person_week_stats s
    join public.scorecard_weeks w on w.week_id = s.week_id where w.week_start = ws - 7)
  select p.person_id, p.full_name, p.job_role, p.app_role, p.manager_id, p.weekly_target, p.show_on_ranked_scorecard,
         coalesce(cnt.n, 0), coalesce(cnt.p, 0),
         case when p.weekly_target > 0 then round(coalesce(cnt.n, 0)::numeric / p.weekly_target, 4) end,
         (p.weekly_target > 0 and coalesce(cnt.n, 0) >= least(5, p.weekly_target)),
         case when (p.weekly_target > 0 and coalesce(cnt.n, 0) >= least(5, p.weekly_target)) then coalesce(prev.streak_weeks, 0) + 1 else 0 end,
         coalesce(bc.codes, '{}'::jsonb)
  from public.acsia_people p
  left join cnt on cnt.person_id = p.person_id
  left join bc on bc.person_id = p.person_id
  left join prev on prev.person_id = p.person_id
  where p.active and p.archived_at is null and p.is_participant and p.weekly_target > 0
    and (public.is_exec() or p.person_id = me or (public.is_manager() and p.person_id = any(public.my_team_ids())))
  order by 6 desc, p.full_name;
end $$;

-- Roster-wide totals for one week (exec only): what the Friday scorecard freezes.
create or replace function public._week_totals(p_week date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ws as (select public.week_start_of(p_week) d),
  roster as (select p.person_id, p.weekly_target from public.acsia_people p where p.active and p.archived_at is null and p.is_participant and p.weekly_target > 0),
  cnt as (select ac.person_id, count(*)::int n from public.actions ac, ws where ac.action_date between ws.d and ws.d + 6 and ac.archived_at is null group by ac.person_id)
  select jsonb_build_object(
    'week_start', (select d from ws),
    'roster_size', (select count(*) from roster),
    'participants', (select count(*) from roster r left join cnt c on c.person_id = r.person_id where coalesce(c.n, 0) >= least(5, r.weekly_target)),
    'total_actions', (select coalesce(sum(n), 0) from cnt),
    'proposals_raised', (select count(*) from public.opportunities o, ws where o.proposal_sent_date between ws.d and ws.d + 6 and o.archived_at is null),
    'opps_created', (select count(*) from public.opportunities o, ws where o.origin = 'Outgrow action' and (o.created_at at time zone 'Asia/Kolkata')::date between ws.d and ws.d + 6 and o.archived_at is null),
    'followups_made', (select count(*) from public.actions ac, ws where ac.action_code = 'OG2.3' and ac.action_date between ws.d and ws.d + 6 and ac.archived_at is null),
    'est_value_surfaced_usd', (select coalesce(sum(ac.estimated_value_usd), 0) from public.actions ac, ws
                               where ac.action_code <> 'OG0.1' and coalesce(ac.value_stage, 'Opportunity') <> 'Closed' and ac.action_date between ws.d and ws.d + 6 and ac.archived_at is null)
  ) $$;

create or replace function public.week_summary(p_week date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j jsonb;
begin
  if not public.is_exec() then raise exception 'NOT_ALLOWED: scorecard totals are for the Outgrow leader, CEO and admin' using errcode = '42501'; end if;
  j := public._week_totals(p_week);
  if not public.can_see_money() then j := j - 'est_value_surfaced_usd'; end if;
  j := j || jsonb_build_object('participation_rate',
        case when (j ->> 'roster_size')::int > 0 then round((j ->> 'participants')::numeric / (j ->> 'roster_size')::int, 4) end);
  return j;
end $$;

-- Freeze (or refresh, while not yet published) person_week_stats and scorecard totals for a week. Internal: cron + publish.
create or replace function public.freeze_week(p_week date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws date := public.week_start_of(p_week); v_week uuid; v_status text; tot jsonb;
begin
  insert into public.scorecard_weeks (week_start, status) values (ws, 'Draft') on conflict (week_start) do nothing;
  select week_id, status into v_week, v_status from public.scorecard_weeks where week_start = ws;
  if v_status = 'Published' then raise exception 'ALREADY_PUBLISHED: week % is frozen', ws; end if;

  with roster as (
    select p.person_id, p.weekly_target, p.show_on_ranked_scorecard from public.acsia_people p
    where p.active and p.archived_at is null and p.is_participant and p.weekly_target > 0),
  cnt as (select ac.person_id, count(*)::int n, (count(*) filter (where ac.action_code = 'OG0.1'))::int p
          from public.actions ac where ac.action_date between ws and ws + 6 and ac.archived_at is null group by ac.person_id),
  bc as (select g.person_id, jsonb_object_agg(g.action_code, g.n) codes
         from (select ac.person_id, ac.action_code, count(*)::int n from public.actions ac
               where ac.action_date between ws and ws + 6 and ac.archived_at is null group by ac.person_id, ac.action_code) g group by g.person_id),
  prev as (select s.person_id, s.streak_weeks from public.person_week_stats s join public.scorecard_weeks w on w.week_id = s.week_id where w.week_start = ws - 7),
  calc as (
    select r.person_id, coalesce(cnt.n, 0) n, coalesce(cnt.p, 0) p, r.weekly_target, r.show_on_ranked_scorecard,
           (coalesce(cnt.n, 0) >= least(5, r.weekly_target)) participated, coalesce(prev.streak_weeks, 0) prev_streak, coalesce(bc.codes, '{}'::jsonb) codes
    from roster r left join cnt on cnt.person_id = r.person_id left join bc on bc.person_id = r.person_id left join prev on prev.person_id = r.person_id)
  insert into public.person_week_stats (week_id, person_id, actions, proactive_touches, target, pct_of_target, participated, streak_weeks, rank, by_code)
  select v_week, c.person_id, c.n, c.p, c.weekly_target, round(c.n::numeric / c.weekly_target, 4), c.participated,
         case when c.participated then c.prev_streak + 1 else 0 end,
         case when c.show_on_ranked_scorecard and c.n > 0 then dense_rank() over (partition by c.show_on_ranked_scorecard order by c.n desc) end,
         c.codes
  from calc c
  on conflict (week_id, person_id) do update set actions = excluded.actions, proactive_touches = excluded.proactive_touches, target = excluded.target,
    pct_of_target = excluded.pct_of_target, participated = excluded.participated, streak_weeks = excluded.streak_weeks, rank = excluded.rank, by_code = excluded.by_code;

  tot := public._week_totals(ws);
  update public.scorecard_weeks set
    total_actions = (tot ->> 'total_actions')::int,
    participation_rate = case when (tot ->> 'roster_size')::int > 0 then round((tot ->> 'participants')::numeric / (tot ->> 'roster_size')::int, 4) end,
    proposals_raised = (tot ->> 'proposals_raised')::int,
    opps_created = (tot ->> 'opps_created')::int,
    followups_made = (tot ->> 'followups_made')::int,
    est_value_surfaced_usd = (tot ->> 'est_value_surfaced_usd')::numeric,
    featured_story_ids = coalesce(featured_story_ids, array(select story_id from public.success_stories
                            where status in ('Nominated', 'Featured') and archived_at is null
                              and created_at >= (ws::timestamp at time zone 'Asia/Kolkata') and created_at < ((ws + 7)::timestamp at time zone 'Asia/Kolkata')
                            order by value_usd desc nulls last limit 1))
  where week_id = v_week;
  return v_week;
end $$;

create or replace function public.save_scorecard_commentary(p_week date, p_commentary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_week uuid; v_status text;
begin
  if not public.is_exec() then raise exception 'NOT_ALLOWED: only the Outgrow leader or CEO can write the commentary' using errcode = '42501'; end if;
  v_week := public.freeze_week(p_week);
  select status into v_status from public.scorecard_weeks where week_id = v_week;
  update public.scorecard_weeks set ceo_commentary = left(btrim(coalesce(p_commentary, '')), 1500),
         status = case when v_status = 'Draft' then 'Awaiting commentary' else v_status end where week_id = v_week;
  return v_week;
end $$;

-- Roster people named in a piece of text (participants only, so "CEO" or "Leader" cannot be used to cheat the rule).
create or replace function public.people_named_in(p_text text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.person_id), '{}'::uuid[]) from public.acsia_people p
  where p.active and p.archived_at is null and p.is_participant and p.weekly_target > 0
    and length(regexp_replace(split_part(p.full_name, ' ', 1), '[^[:alnum:]]', '', 'g')) >= 3
    and coalesce(p_text, '') ~* ('\m' || regexp_replace(split_part(p.full_name, ' ', 1), '[^[:alnum:]]', '', 'g') || '\M') $$;

create or replace function public.publish_scorecard(p_week date, p_commentary text, p_story uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_week uuid; named uuid[]; n int; ws date := public.week_start_of(p_week); notified int;
begin
  if not public.is_exec() then raise exception 'NOT_ALLOWED: only the Outgrow leader or CEO can publish' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_commentary, ''))) = 0 then raise exception 'COMMENTARY_REQUIRED: write two sentences of commentary'; end if;
  named := public.people_named_in(p_commentary);
  if coalesce(array_length(named, 1), 0) < 2 then raise exception 'NAMES_REQUIRED: name at least two roster people in the commentary'; end if;
  v_week := public.freeze_week(ws);   -- final refresh; raises if already published
  if p_story is not null then
    update public.success_stories set status = 'Featured', featured_week_id = v_week where story_id = p_story and status in ('Nominated', 'Featured');
    update public.scorecard_weeks set featured_story_ids = array[p_story] where week_id = v_week;
  else
    update public.success_stories set status = 'Featured', featured_week_id = v_week
    where story_id = any((select featured_story_ids from public.scorecard_weeks where week_id = v_week)::uuid[]) and status = 'Nominated';
  end if;
  update public.scorecard_weeks set status = 'Published', ceo_commentary = left(btrim(p_commentary), 1500), named_person_ids = named, published_at = now() where week_id = v_week;
  insert into public.notifications (person_id, kind, title, body, link)
  select p.person_id, 'scorecard', 'The Friday scorecard is out', 'Week of ' || to_char(ws, 'DD Mon'), '/scorecard'
  from public.acsia_people p where p.active and p.archived_at is null and p.is_participant;
  get diagnostics notified = row_count;
  return jsonb_build_object('week_id', v_week, 'named_person_ids', to_jsonb(named), 'notified', notified);
end $$;

-- Programme week number (1-based). Conversion rates stay hidden until week 12 (PRD principle 7).
create or replace function public.programme_week() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select ((public.today_ist() - public.week_start_of(nullif(value, '')::date)) / 7 + 1) from public.app_settings where key = 'programme_start' and nullif(value, '') is not null),
    (select ((public.today_ist() - public.week_start_of(min(touch_date))) / 7 + 1)::int from public.touches where is_example = false),
    0) $$;

grant execute on function public.week_stats(date), public.week_summary(date), public.save_scorecard_commentary(date, text),
  public.people_named_in(text), public.publish_scorecard(date, text, uuid), public.programme_week() to authenticated;
