-- M1: assignments carry a short "why now" (<= 5 words, shown as a chip on the Today card). The operator planner (M2) fills it too.

alter table public.assignments add column if not exists why_now text;
comment on column public.assignments.why_now is 'Short reason this contact, this week (<= 5 words). Shown as a chip on the assignment card.';

create or replace function public.create_assignment(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id();
  v_assignee uuid := nullif(p ->> 'assignee_id', '')::uuid;
  v_contact uuid := nullif(p ->> 'contact_id', '')::uuid;
  v_account uuid; c_status text; v_id uuid; cn text;
begin
  if me is null then raise exception 'NO_PERSON: your account is not on the roster' using errcode = '42501'; end if;
  if not public._can_manage_assignee(v_assignee) then raise exception 'NOT_ALLOWED: you can only assign your own team' using errcode = '42501'; end if;
  if length(btrim(coalesce(p ->> 'instruction', ''))) = 0 then raise exception 'EMPTY: write a one-sentence instruction'; end if;
  select account_id, contact_status, first_name || ' ' || last_name into v_account, c_status, cn from public.contacts where contact_id = v_contact and archived_at is null;
  if not found then raise exception 'BAD_CONTACT: choose a contact'; end if;
  if c_status in ('Do not contact', 'Left company') then raise exception 'CONTACT_BLOCKED: this contact is %', c_status; end if;
  if not exists (select 1 from public.acsia_people where person_id = v_assignee and active and archived_at is null and is_participant) then
    raise exception 'BAD_PERSON: that person is not an active participant';
  end if;
  insert into public.assignments (week_start, assignee_id, assigned_by_id, contact_id, account_id, opportunity_id, list_id, expected_action_code, suggested_play_id, instruction, why_now, due_date, status)
  values (coalesce(nullif(p ->> 'week_start', '')::date, public.week_start_of(public.today_ist())), v_assignee, me, v_contact, v_account,
          nullif(p ->> 'opportunity_id', '')::uuid, nullif(p ->> 'list_id', ''), nullif(p ->> 'expected_action_code', ''), nullif(p ->> 'suggested_play_id', ''),
          left(btrim(p ->> 'instruction'), 500), nullif(left(btrim(coalesce(p ->> 'why_now', '')), 60), ''), nullif(p ->> 'due_date', '')::date,
          case when p ->> 'status' = 'Draft' then 'Draft' else 'Open' end)
  returning assignment_id into v_id;
  if v_assignee <> me and p ->> 'status' is distinct from 'Draft' then
    perform public.notify(v_assignee, 'assignment', 'New assignment: ' || cn, left(btrim(p ->> 'instruction'), 140), '/today');
  end if;
  return v_id;
end $$;

create or replace function public.update_assignment(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare cur record; new_assignee uuid;
begin
  select assignee_id, status into cur from public.assignments where assignment_id = p_id;
  if not found then raise exception 'NOT_FOUND: assignment'; end if;
  if not public._can_manage_assignee(cur.assignee_id) then raise exception 'NOT_ALLOWED: you can only edit your team''s assignments' using errcode = '42501'; end if;
  if cur.status not in ('Draft', 'Open') then raise exception 'LOCKED: only Draft or Open assignments can be edited'; end if;
  new_assignee := coalesce(nullif(p ->> 'assignee_id', '')::uuid, cur.assignee_id);
  if new_assignee <> cur.assignee_id and not public._can_manage_assignee(new_assignee) then raise exception 'NOT_ALLOWED: you can only assign your own team' using errcode = '42501'; end if;
  if p ? 'instruction' and length(btrim(coalesce(p ->> 'instruction', ''))) = 0 then raise exception 'EMPTY: write a one-sentence instruction'; end if;
  update public.assignments set
    assignee_id = new_assignee,
    instruction = case when p ? 'instruction' then left(btrim(p ->> 'instruction'), 500) else instruction end,
    why_now = case when p ? 'why_now' then nullif(left(btrim(coalesce(p ->> 'why_now', '')), 60), '') else why_now end,
    due_date = case when p ? 'due_date' then nullif(p ->> 'due_date', '')::date else due_date end,
    suggested_play_id = case when p ? 'suggested_play_id' then nullif(p ->> 'suggested_play_id', '') else suggested_play_id end,
    expected_action_code = case when p ? 'expected_action_code' then nullif(p ->> 'expected_action_code', '') else expected_action_code end
  where assignment_id = p_id;
end $$;

-- create/replace keeps existing grants; restate them so a fresh database ends in the same state.
grant execute on function public.create_assignment(jsonb), public.update_assignment(uuid, jsonb) to authenticated;
