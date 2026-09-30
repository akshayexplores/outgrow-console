-- Milestone 2, part 3: the quarterly analyst's input, measured on ONE window.
-- Actions in the last 91 days, and the opportunities that trace back (source_action_id) to those actions. Rates are computed here, in the database,
-- never by the model: locked before programme week 12, withheld below 30 actions per code, and OG0.1 (added by code) is never a conversion candidate.
-- Counts only: no money, no names, no contact details. Service role only.
create or replace function public.analyst_input() returns jsonb
language sql stable security definer set search_path = '' as $$
  with win as (select public.today_ist() - 91 as since, public.programme_week() as wk),
  acts as (
    select a.action_id, a.action_code from public.actions a, win
    where a.archived_at is null and not a.is_example and a.action_code <> 'OG0.1' and a.action_date >= win.since),
  opps as (
    select o.opportunity_id, o.stage, acts.action_code from public.opportunities o join acts on acts.action_id = o.source_action_id
    where o.origin = 'Outgrow action' and o.archived_at is null and not o.is_example),
  by_code as (
    select c.action_code, count(*)::int as actions, (select count(*)::int from opps where opps.action_code = c.action_code) as opportunities
    from acts c group by c.action_code)
  select jsonb_build_object(
    'programme_week', (select wk from win),
    'rates_unlocked', (select wk >= 12 from win),
    'actions_by_code', coalesce((select jsonb_agg(jsonb_build_object('code', g.action_code, 'actions', g.n) order by g.action_code)
                                 from (select a.action_code, count(*)::int n from public.actions a, win
                                       where a.archived_at is null and not a.is_example and a.action_date >= win.since group by a.action_code) g), '[]'::jsonb),
    'by_code', coalesce((select jsonb_agg(jsonb_build_object(
                    'code', b.action_code, 'actions', b.actions, 'opportunities', b.opportunities, 'enough_data', b.actions >= 30,
                    'rate', case when (select wk from win) >= 12 and b.actions >= 30 then round(b.opportunities::numeric / b.actions, 4) end) order by b.action_code)
                 from by_code b), '[]'::jsonb),
    'opps_by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'count', s.n) order by s.stage) from (select stage, count(*)::int n from opps group by stage) s), '[]'::jsonb),
    'participation_by_week', coalesce((select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'participation_rate', w.participation_rate, 'total_actions', w.total_actions) order by w.week_start)
                                 from (select week_start, participation_rate, total_actions from public.scorecard_weeks
                                       where archived_at is null and not is_example and status = 'Published' order by week_start desc limit 13) w), '[]'::jsonb),
    'new_service_lines_bought_last_90_days', (select count(*)::int from public.whitespace_map w
                                       where w.status = 'Buying from Acsia' and w.archived_at is null and not w.is_example and w.created_at >= now() - interval '90 days')
  ) $$;

revoke execute on function public.analyst_input() from public, anon, authenticated;
grant execute on function public.analyst_input() to service_role;
