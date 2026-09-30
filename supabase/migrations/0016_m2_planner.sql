-- Milestone 2, part 2: the Monday planner's drafts, and the Operator screen's numbers.
--   * save_planned_assignments(): the planner (service role) hands over drafts; the DATABASE re-checks every row and inserts them as
--     Draft, so a model or a bug can never create an assignment for a blocked contact, an inactive person or a second person on the same contact.
--   * approve_assignments(): same behaviour as before, plus it records whether people accepted the run that produced the drafts.
--   * mark_ai_run_accepted(): used when someone takes the operator's scorecard draft or guardrail explanation.
--   * ai_dashboard() / ai_month_cost(): per-job counts, latency, cost and acceptance for the Operator screen (leader and admin only).

------------------------------------------------------------------ columns
-- True for rows the planner (AI or the plain rules) drafted. A "Redraft" replaces only these, and only while they are still Draft.
alter table public.assignments add column if not exists operator_draft boolean not null default false;

------------------------------------------------------------------ the planner hands over its drafts
create or replace function public.save_planned_assignments(p_week date, p_run uuid, p_rows jsonb, p_replace_for uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws date := public.week_start_of(p_week);
  r jsonb; v_assignee uuid; v_contact uuid; v_account uuid; c_status text; v_by uuid; v_play text; v_code text; v_list text; v_opp uuid;
  n_ins int := 0; n_skip int := 0; n_replaced int := 0; got int; old_runs uuid[] := '{}';
  codes constant text[] := array['OG0.1', 'OG1.1', 'OG1.2', 'OG2.1', 'OG2.2', 'OG2.3', 'OG2.4', 'OG3.1', 'OG4.1', 'OG4.2', 'OG5.1', 'OG6.1'];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'BAD_ROWS: p_rows must be a JSON array'; end if;

  if p_replace_for is not null then
    select coalesce(array_agg(distinct a.ai_run_id) filter (where a.ai_run_id is not null), '{}') into old_runs
      from public.assignments a
      where a.week_start = ws and a.status = 'Draft' and a.operator_draft and a.archived_at is null and a.assignee_id = any(p_replace_for);
    update public.assignments set status = 'Dropped'
      where week_start = ws and status = 'Draft' and operator_draft and archived_at is null and assignee_id = any(p_replace_for);
    get diagnostics n_replaced = row_count;
    -- Asking for a different plan means the earlier run was not accepted (unless some of its drafts are still live for other people).
    update public.ai_runs u set accepted = false
      where u.id = any(old_runs) and u.accepted is null
        and not exists (select 1 from public.assignments a where a.ai_run_id = u.id and a.status <> 'Dropped');
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_assignee := nullif(r ->> 'assignee_id', '')::uuid;
    v_contact := nullif(r ->> 'contact_id', '')::uuid;

    if length(btrim(coalesce(r ->> 'instruction', ''))) = 0 then n_skip := n_skip + 1; continue; end if;
    if not exists (select 1 from public.acsia_people p where p.person_id = v_assignee and p.active and p.archived_at is null and p.is_participant and p.weekly_target > 0) then
      n_skip := n_skip + 1; continue;
    end if;
    select c.account_id, c.contact_status into v_account, c_status from public.contacts c where c.contact_id = v_contact and c.archived_at is null;
    if not found or c_status in ('Do not contact', 'Left company') then n_skip := n_skip + 1; continue; end if;
    if exists (select 1 from public.assignments a where a.week_start = ws and a.contact_id = v_contact and a.status <> 'Dropped' and a.archived_at is null) then
      n_skip := n_skip + 1; continue;
    end if;

    -- "From": the person's manager if they have an active one, else the first active leader, else the person themselves (column is required).
    select m.person_id into v_by from public.acsia_people m
      where m.person_id = (select p.manager_id from public.acsia_people p where p.person_id = v_assignee) and m.active and m.archived_at is null;
    if v_by is null then
      select l.person_id into v_by from public.acsia_people l where l.app_role = 'leader' and l.active and l.archived_at is null order by l.created_at, l.person_id limit 1;
    end if;
    v_by := coalesce(v_by, v_assignee);

    v_play := case when exists (select 1 from public.plays pl where pl.play_id = r ->> 'suggested_play_id' and pl.approval_status like 'Approved%' and pl.archived_at is null)
                   then r ->> 'suggested_play_id' end;
    v_code := nullif(r ->> 'expected_action_code', '');
    if v_code is not null and not (v_code = any(codes)) then v_code := null; end if;
    v_list := case when exists (select 1 from public.list_definitions ld where ld.list_id = r ->> 'list_id') then r ->> 'list_id' end;
    v_opp := (select o.opportunity_id from public.opportunities o where o.opportunity_id = nullif(r ->> 'opportunity_id', '')::uuid and o.archived_at is null);

    insert into public.assignments (week_start, assignee_id, assigned_by_id, contact_id, account_id, opportunity_id, list_id, expected_action_code, suggested_play_id,
                                    instruction, why_now, due_date, status, ai_run_id, operator_draft)
    values (ws, v_assignee, v_by, v_contact, v_account, v_opp, v_list, v_code, v_play,
            left(btrim(r ->> 'instruction'), 500), nullif(left(btrim(coalesce(r ->> 'why_now', '')), 60), ''),
            coalesce(nullif(r ->> 'due_date', '')::date, ws + 4), 'Draft', p_run, true)
    on conflict do nothing;
    get diagnostics got = row_count;
    if got > 0 then n_ins := n_ins + 1; else n_skip := n_skip + 1; end if;
  end loop;

  -- Keep the lists' "assigned this week" flag honest, both ways (drafts replaced above no longer count).
  update public.list_memberships m set assigned_this_week = x.asg
  from (select m2.membership_id, exists (
          select 1 from public.assignments a
          where a.week_start = ws and a.status <> 'Dropped' and a.archived_at is null
            and ((m2.contact_id is not null and a.contact_id = m2.contact_id) or (m2.opportunity_id is not null and a.opportunity_id = m2.opportunity_id))) as asg
        from public.list_memberships m2 where m2.exited_at is null and m2.archived_at is null) x
  where x.membership_id = m.membership_id and m.assigned_this_week is distinct from x.asg;

  return jsonb_build_object('inserted', n_ins, 'skipped', n_skip, 'replaced', n_replaced);
end $$;

------------------------------------------------------------------ approve / drop: record whether the operator's plan was accepted
create or replace function public.approve_assignments(p_ids uuid[], p_approve boolean default true) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; runs uuid[] := '{}';
begin
  for r in select a.assignment_id, a.assignee_id, a.instruction, a.ai_run_id, c.first_name || ' ' || c.last_name as cn
           from public.assignments a join public.contacts c on c.contact_id = a.contact_id
           where a.assignment_id = any(p_ids) and a.status = 'Draft' loop
    if not public._can_manage_assignee(r.assignee_id) then continue; end if;
    update public.assignments set status = case when p_approve then 'Open' else 'Dropped' end where assignment_id = r.assignment_id;
    if p_approve then perform public.notify(r.assignee_id, 'assignment', 'New assignment: ' || r.cn, left(r.instruction, 140), '/today'); end if;
    if r.ai_run_id is not null then runs := runs || r.ai_run_id; end if;
    n := n + 1;
  end loop;

  -- Once every draft from a run has been decided, the run counts as accepted when at least half were kept.
  if array_length(runs, 1) is not null then
    update public.ai_runs u set accepted = (s.kept * 2 >= s.total)
    from (select a.ai_run_id, count(*) as total, count(*) filter (where a.status <> 'Dropped') as kept, count(*) filter (where a.status = 'Draft') as pending
          from public.assignments a where a.ai_run_id = any(runs) group by a.ai_run_id) s
    where u.id = s.ai_run_id and s.pending = 0;
  end if;
  return n;
end $$;

------------------------------------------------------------------ accepted / not accepted for single-answer jobs
-- The person who triggered the run, or the exec for the Friday draft (the cron writes it with no person).
create or replace function public.mark_ai_run_accepted(p_run uuid, p_accepted boolean default true) returns void
language sql security definer set search_path = '' as $$
  update public.ai_runs r set accepted = p_accepted
  where r.id = p_run and r.accepted is distinct from p_accepted
    and ((r.person_id is not null and r.person_id = public.current_person_id()) or (r.job = 'score' and public.is_exec())) $$;

------------------------------------------------------------------ the Operator screen's numbers
create or replace function public.ai_dashboard(p_days int default 30)
returns table (job text, runs int, ok int, fallback int, invalid int, failed int, blocked int, limited int, avg_ms int, p95_ms int, cost_usd numeric, accepted int, decided int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_leader() then raise exception 'NOT_ALLOWED: the AI dashboard is for the Outgrow leader and admin' using errcode = '42501'; end if;
  return query
  select r.job, count(*)::int,
         (count(*) filter (where r.status = 'ok'))::int,
         (count(*) filter (where r.status = 'fallback_used'))::int,
         (count(*) filter (where r.status = 'invalid_output'))::int,
         (count(*) filter (where r.status = 'error'))::int,
         (count(*) filter (where r.status = 'blocked_by_guardrail'))::int,
         (count(*) filter (where r.status in ('rate_limited', 'budget_exceeded')))::int,
         coalesce(round(avg(r.latency_ms)), 0)::int,
         coalesce(round(percentile_cont(0.95) within group (order by r.latency_ms)), 0)::int,
         coalesce(sum(r.cost_usd), 0)::numeric,
         (count(*) filter (where r.accepted))::int,
         (count(*) filter (where r.accepted is not null))::int
  from public.ai_runs r
  where r.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  group by r.job order by r.job;
end $$;

create or replace function public.ai_month_cost() returns numeric
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_leader() then raise exception 'NOT_ALLOWED: the AI dashboard is for the Outgrow leader and admin' using errcode = '42501'; end if;
  return (select coalesce(sum(r.cost_usd), 0) from public.ai_runs r
          where r.created_at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
end $$;

------------------------------------------------------------------ grants
revoke execute on function public.save_planned_assignments(date, uuid, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.save_planned_assignments(date, uuid, jsonb, uuid[]) to service_role;
revoke execute on function public.mark_ai_run_accepted(uuid, boolean), public.ai_dashboard(int), public.ai_month_cost() from public, anon;
grant execute on function public.mark_ai_run_accepted(uuid, boolean), public.ai_dashboard(int), public.ai_month_cost() to authenticated, service_role;
-- create/replace keeps existing grants; restate so a fresh database ends in the same state.
grant execute on function public.approve_assignments(uuid[], boolean) to authenticated;
