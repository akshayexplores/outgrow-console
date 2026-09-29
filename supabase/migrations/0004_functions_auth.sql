-- RLS helper functions, the sign-up gate (Before User Created hook) and the auth.users link trigger.
-- All helpers are SECURITY DEFINER with an empty search_path; roles are read from the DB on every request.

-- Default-deny for anything created from here on: nothing is executable/readable by anon or authenticated unless granted explicitly.
alter default privileges revoke execute on functions from public;   -- global: PUBLIC's built-in EXECUTE cannot be revoked per-schema
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create or replace function public.current_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select person_id from public.acsia_people
  where auth_user_id = (select auth.uid()) and active and archived_at is null limit 1 $$;

create or replace function public.current_app_role() returns text
language sql stable security definer set search_path = '' as $$
  select app_role from public.acsia_people
  where auth_user_id = (select auth.uid()) and active and archived_at is null limit 1 $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(lower((select auth.jwt()) ->> 'email') = nullif((select lower(value) from public.app_settings where key = 'admin_email'), ''), false) $$;

create or replace function public.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_person_id() is not null or public.is_admin() $$;

-- Engineers are limited; the admin is never limited whatever roster role they hold.
create or replace function public.is_engineer() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_admin() and coalesce(public.current_app_role() = 'engineer', false) $$;

create or replace function public.is_leader() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.current_app_role() = 'leader', false) $$;

create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'ceo', false) $$;

create or replace function public.is_exec() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_leader() or public.is_ceo() $$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'delivery_lead', false) $$;

-- Money = revenue, pipeline value, competitor names/intel.
create or replace function public.can_see_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.current_app_role() in ('ae','sdr','leader','ceo'), false) $$;

-- Rapport notes: docs/03 matrix (not engineer, presales/marketing or ceo).
create or replace function public.can_see_rapport() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.current_app_role() in ('pm','delivery_lead','ae','sdr','leader'), false) $$;

create or replace function public.can_log() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.current_app_role() in ('pm','delivery_lead','ae','sdr','presales','marketing','leader'), false) $$;

create or replace function public.my_team_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(person_id), '{}'::uuid[]) from public.acsia_people
  where manager_id = public.current_person_id() and active and archived_at is null $$;

-- Programmes / accounts an engineer sits inside (docs/03: "limited*").
create or replace function public.my_programme_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct pt.programme_id), '{}'::uuid[]) from public.programme_team pt
  where pt.person_id = public.current_person_id() and pt.archived_at is null and (pt.end_date is null or pt.end_date >= current_date) $$;

create or replace function public.my_account_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select p.contracting_account_id x from public.programmes p where p.programme_id = any(public.my_programme_ids())
    union select p.end_customer_account_id from public.programmes p where p.programme_id = any(public.my_programme_ids()) and p.end_customer_account_id is not null
  ) s $$;

create or replace function public.vis_account(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_employee() and (not public.is_engineer() or a = any(public.my_account_ids())) $$;

create or replace function public.week_is_published(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.scorecard_weeks where week_id = w and status = 'Published') $$;

create or replace function public.week_start_of(d date) returns date
language sql immutable as $$ select date_trunc('week', d::timestamp)::date $$;

create or replace function public.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.touch_type_is_proactive(t text) returns boolean
language sql immutable as $$ select t in ('Proactive call','Voicemail + text','Unscheduled visit (on site)','Handwritten note') $$;
-- OG0.1 = proactive call / visit only (a handwritten note is counted by its own OG6.1).
create or replace function public.touch_type_adds_og01(t text) returns boolean
language sql immutable as $$ select t in ('Proactive call','Voicemail + text','Unscheduled visit (on site)') $$;

------------------------------------------------------------------ sign-up gate
-- Supabase Auth "Before User Created" hook. Returns {} to allow, or {"error": {...}} to block.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e text := lower(btrim(coalesce(event->'user'->>'email','')));
  admin_e text := nullif((select lower(value) from public.app_settings where key = 'admin_email'), '');
  dom text := nullif((select lower(value) from public.app_settings where key = 'allowed_email_domain'), '');
begin
  if e = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'An email address is required.'));
  end if;
  if admin_e is not null and e = admin_e then return '{}'::jsonb; end if;
  if dom is not null and split_part(e, '@', 2) <> dom then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Use your company email address.'));
  end if;
  if exists (select 1 from public.acsia_people where lower(email) = e and active and archived_at is null) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Your email has not been added yet. Ask the Outgrow admin to add you.'));
end $$;

-- Link the auth user to the roster row on creation and keep last_sign_in_at fresh.
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.acsia_people
     set auth_user_id = coalesce(auth_user_id, new.id),
         last_sign_in_at = coalesce(new.last_sign_in_at, last_sign_in_at)
   where lower(email) = lower(new.email) and (auth_user_id is null or auth_user_id = new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_auth_user();
drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row when (new.last_sign_in_at is distinct from old.last_sign_in_at) execute function public.link_auth_user();

-- Roster row added AFTER the person already has an auth user (e.g. the admin adds their own profile): link by email.
create or replace function public.trg_people_link_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auth_user_id is null then
    select u.id into new.auth_user_id from auth.users u where lower(u.email) = lower(new.email) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_people_link_auth on public.acsia_people;
create trigger trg_people_link_auth before insert or update of email on public.acsia_people
  for each row execute function public.trg_people_link_auth();
revoke execute on function public.trg_people_link_auth() from public, anon, authenticated;

------------------------------------------------------------------ grants
-- Lock functions down: nothing is callable by anon; the hook only by the auth service.
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.link_auth_user() from public, anon, authenticated;

grant execute on function
  public.current_person_id(), public.current_app_role(), public.is_admin(), public.is_employee(), public.is_engineer(),
  public.is_leader(), public.is_ceo(), public.is_exec(), public.is_manager(), public.can_see_money(), public.can_see_rapport(),
  public.can_log(), public.my_team_ids(), public.my_programme_ids(), public.my_account_ids(), public.vis_account(uuid),
  public.week_start_of(date), public.week_is_published(uuid), public.today_ist(), public.touch_type_is_proactive(text), public.touch_type_adds_og01(text)
  to authenticated;
