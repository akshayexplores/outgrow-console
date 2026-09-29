-- Supabase advisor clean-up: pinned search_path on the remaining helpers, one policy per action (no overlapping permissive
-- SELECT policies), duplicate/missing FK indexes. Behaviour is unchanged (tests/rls.sql still passes).
alter function public.set_updated_at() set search_path = '';
alter function public.trg_touches_bi() set search_path = '';
alter function public.trg_opps_bu() set search_path = '';
alter function public.today_ist() set search_path = '';
alter function public.week_start_of(date) set search_path = '';
alter function public.touch_type_is_proactive(text) set search_path = '';
alter function public.touch_type_adds_og01(text) set search_path = '';

do $$
declare r record;
begin
  for r in select * from (values
      ('service_lines','service_lines_write','is_leader','service_lines'), ('capabilities','capabilities_write','is_leader','capabilities'),
      ('focus_calendar','focus_calendar_write','is_leader','focus_calendar'), ('channel_rules','channel_rules_write','is_leader','channel_rules'),
      ('list_definitions','list_definitions_write','is_leader','list_definitions'), ('plays','plays_write','is_leader','plays'),
      ('testimonials','testimonials_write','is_leader','testimonials'), ('happy_customer_interviews','happy_customer_interviews_write','is_leader','happy_customer_interviews'),
      ('proof_points','proof_points_write','is_leader','proof_points'), ('picklists','picklists_write','is_admin','picklists'),
      ('acsia_people','people_admin','is_admin','people'), ('app_settings','settings_admin','is_admin','settings')
    ) as v(tbl, old_policy, fn, pfx)
  loop
    execute format('drop policy if exists %I on public.%I', r.old_policy, r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.%I()))', r.pfx || '_ins', r.tbl, r.fn);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.%I())) with check ((select public.%I()))', r.pfx || '_upd', r.tbl, r.fn, r.fn);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.%I()))', r.pfx || '_del', r.tbl, r.fn);
  end loop;
end $$;

drop index if exists public.acsia_people_manager_idx;
drop index if exists public.acsia_people_auth_idx;
drop index if exists public.contacts_account_idx;
create index if not exists capture_inbox_logged_by_idx on public.capture_inbox (logged_by_id);
create index if not exists capture_inbox_touch_idx on public.capture_inbox (touch_id);
