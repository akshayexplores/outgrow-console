-- Write path. Business tables have no direct INSERT/UPDATE/DELETE for authenticated users; everything goes through these
-- SECURITY DEFINER functions, which re-check the caller's role, enforce the Outgrow rules and write in ONE transaction.

------------------------------------------------------------------ internal helpers (not granted to clients)
create or replace function public.notify(p_person uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (person_id, kind, title, body, link) values (p_person, p_kind, p_title, p_body, p_link) $$;

create or replace function public._can_manage_assignee(p_assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_leader()
      or (public.is_manager() and (p_assignee = public.current_person_id() or p_assignee = any(public.my_team_ids()))) $$;

------------------------------------------------------------------ who am I
create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object(
        'person_id', p.person_id, 'full_name', p.full_name, 'email', p.email, 'app_role', p.app_role, 'manager_id', p.manager_id,
        'weekly_target', p.weekly_target, 'welcomed_at', p.welcomed_at, 'show_on_ranked_scorecard', p.show_on_ranked_scorecard,
        'is_admin', public.is_admin(), 'can_see_money', public.can_see_money(), 'on_roster', true)
     from public.acsia_people p where p.auth_user_id = (select auth.uid()) and p.active and p.archived_at is null limit 1),
    (select jsonb_build_object('person_id', null, 'full_name', 'Admin', 'email', (select auth.jwt()) ->> 'email', 'app_role', null,
        'manager_id', null, 'weekly_target', 0, 'welcomed_at', now(), 'show_on_ranked_scorecard', false,
        'is_admin', true, 'can_see_money', true, 'on_roster', false)
     where public.is_admin())
  ) $$;

create or replace function public.mark_welcomed() returns void
language sql security definer set search_path = '' as $$
  update public.acsia_people set welcomed_at = coalesce(welcomed_at, now()) where person_id = public.current_person_id() $$;

------------------------------------------------------------------ engineer capture inbox
create or replace function public.submit_capture(p_text text, p_channel text default 'web') returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); mgr uuid; nm text; v uuid;
begin
  if me is null then raise exception 'NO_PERSON: your account is not on the roster' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'EMPTY: write what the customer mentioned'; end if;
  select manager_id, full_name into mgr, nm from public.acsia_people where person_id = me;
  insert into public.capture_inbox (from_person_id, to_manager_id, channel, text) values (me, mgr, coalesce(p_channel, 'web'), btrim(p_text)) returning id into v;
  if mgr is not null then perform public.notify(mgr, 'capture', 'Note from ' || nm, left(btrim(p_text), 140), '/team?tab=inbox'); end if;
  return v;
end $$;

create or replace function public.dismiss_capture(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.capture_inbox set status = 'dismissed', logged_by_id = public.current_person_id()
  where id = p_id and status = 'new' and (to_manager_id = public.current_person_id() or public.is_leader());
  if not found then raise exception 'NOT_FOUND: nothing to dismiss'; end if;
end $$;

------------------------------------------------------------------ THE log: one transaction
-- payload: { touch:{...}, actions:[{action_code,service_line_id,estimated_value_usd,value_stage,play_id,customer_answer,testimonial_id}],
--            follow_through:{insights:[],whitespace:[],opportunities:[],referrals:[],share_reading:{}}, inbox_id, ai_run_ids:[] }
create or replace function public.log_conversation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id();
  t jsonb := coalesce(p -> 'touch', '{}'::jsonb);
  ft jsonb := coalesce(p -> 'follow_through', '{}'::jsonb);
  acts jsonb := coalesce(p -> 'actions', '[]'::jsonb);
  who uuid;
  v_date date;
  v_type text := t ->> 'touch_type';
  v_channel text := t ->> 'channel';
  v_acc uuid := nullif(t ->> 'account_id', '')::uuid;
  v_contact uuid := nullif(t ->> 'contact_id', '')::uuid;
  v_assign uuid := nullif(t ->> 'assignment_id', '')::uuid;
  v_inbox uuid := nullif(p ->> 'inbox_id', '')::uuid;
  v_touch uuid; v_none_sl uuid; v_action uuid; v_first_sl uuid;
  action_ids uuid[] := '{}';
  a jsonb; o jsonb; idx int; n_actions int; k int; code text;
  warnings jsonb := '[]'::jsonb;
  acc_owner uuid; acc_country text;
  c_country text; c_optout text[]; c_status text;
  rule record;
  n_ins int := 0; n_ws int := 0; n_opp int := 0; n_ref int := 0; n_sow int := 0; n_story int := 0;
  opp_id uuid; ref_id uuid; sow_id uuid; sl uuid; ref_type text; sum_val numeric;
  w_start date; w_actions int; w_target int; w_before int; w_threshold int;
  money boolean := public.can_see_money();
begin
  if me is null then raise exception 'NO_PERSON: your account is not on the roster' using errcode = '42501'; end if;
  if not public.can_log() then raise exception 'NOT_ALLOWED: your role cannot log conversations' using errcode = '42501'; end if;

  who := coalesce(nullif(t ->> 'person_id', '')::uuid, me);
  if who <> me then
    if not (public.is_leader() or (public.is_manager() and who = any(public.my_team_ids()))) then
      raise exception 'NOT_ALLOWED: you can only log for your own reports' using errcode = '42501';
    end if;
    if not exists (select 1 from public.acsia_people where person_id = who and active and archived_at is null) then raise exception 'BAD_PERSON: that person is not active'; end if;
  end if;

  v_date := coalesce(nullif(t ->> 'touch_date', '')::date, public.today_ist());
  if v_date > public.today_ist() then raise exception 'BAD_DATE: the conversation date cannot be in the future'; end if;
  if v_date < public.today_ist() - 30 then raise exception 'BAD_DATE: conversations older than 30 days cannot be logged'; end if;
  if v_type is null or v_channel is null then raise exception 'BAD_TOUCH: conversation type and channel are required'; end if;

  select account_owner_id, country into acc_owner, acc_country from public.accounts where account_id = v_acc and archived_at is null;
  if not found then raise exception 'BAD_ACCOUNT: choose an account'; end if;
  if v_contact is not null then
    select country, opt_out_channels, contact_status into c_country, c_optout, c_status
    from public.contacts where contact_id = v_contact and account_id = v_acc and archived_at is null;
    if not found then raise exception 'BAD_CONTACT: that contact is not at this account'; end if;
    if c_status = 'Do not contact' then warnings := warnings || jsonb_build_object('code', 'DO_NOT_CONTACT', 'message', 'This contact is marked Do not contact.'); end if;
    if c_optout is not null and v_channel = any(c_optout) then
      warnings := warnings || jsonb_build_object('code', 'OPT_OUT', 'message', 'This contact opted out of ' || v_channel || '.');
    end if;
  end if;
  for rule in select geography, avoid from public.channel_rules
              where archived_at is null and coalesce(c_country, acc_country) = any(country_codes) and v_channel = any(blocked_channels) loop
    warnings := warnings || jsonb_build_object('code', 'COUNTRY_AVOID', 'message', rule.geography || ': ' || coalesce(nullif(rule.avoid, ''), v_channel || ' is on the avoid list') || '.');
  end loop;

  n_actions := jsonb_array_length(acts);
  if n_actions > 12 then raise exception 'TOO_MANY_ACTIONS: at most 12 asks in one conversation'; end if;
  if n_actions = 0 and not public.touch_type_adds_og01(v_type) then raise exception 'NO_ACTIONS: add at least one ask'; end if;
  select service_line_id into v_none_sl from public.service_lines where short_code = 'NONE';

  insert into public.touches (touch_date, person_id, logged_by_id, account_id, contact_id, programme_id, touch_type, channel, customer_response, note,
                              follow_up_date, follow_up_permission, assignment_id, success_nominated, capture_method, raw_capture_text)
  values (v_date, who, me, v_acc, v_contact, nullif(t ->> 'programme_id', '')::uuid, v_type, v_channel, nullif(t ->> 'customer_response', ''),
          nullif(btrim(t ->> 'note'), ''), nullif(t ->> 'follow_up_date', '')::date, (t ->> 'follow_up_permission')::boolean, v_assign,
          coalesce((t ->> 'success_nominated')::boolean, false), coalesce(nullif(t ->> 'capture_method', ''), 'Web'), nullif(t ->> 'raw_capture_text', ''))
  returning touch_id into v_touch;

  -- OG0.1 is added by code, only for proactive calls / visits.
  if public.touch_type_adds_og01(v_type) then
    insert into public.actions (touch_id, action_code, service_line_id, estimated_value_usd) values (v_touch, 'OG0.1', v_none_sl, 0);
  end if;

  for idx in 0 .. n_actions - 1 loop
    a := acts -> idx;
    code := a ->> 'action_code';
    if code = 'OG0.1' then raise exception 'OG01_CODE_ADDED: OG0.1 is added automatically for proactive calls and visits'; end if;
    sl := nullif(a ->> 'service_line_id', '')::uuid;
    if sl is null then raise exception 'BAD_SERVICE_LINE: every ask needs a service line'; end if;
    if code = 'OG1.1' and sl = v_none_sl then raise exception 'DYK_NEEDS_SERVICE: a Did You Know must name something the customer can pay for'; end if;
    v_first_sl := coalesce(v_first_sl, sl);
    insert into public.actions (touch_id, action_code, service_line_id, estimated_value_usd, value_stage, play_id, customer_answer, testimonial_id)
    values (v_touch, code, sl, coalesce((a ->> 'estimated_value_usd')::numeric, 0), nullif(a ->> 'value_stage', ''), nullif(a ->> 'play_id', ''),
            nullif(btrim(a ->> 'customer_answer'), ''), nullif(a ->> 'testimonial_id', '')::uuid)
    returning action_id into v_action;
    action_ids := action_ids || v_action;
  end loop;

  -- follow-through the person confirmed
  for o in select e from jsonb_array_elements(coalesce(ft -> 'insights', '[]'::jsonb)) as x(e) loop
    if length(btrim(coalesce(o ->> 'text', ''))) = 0 then continue; end if;
    insert into public.insights (account_id, contact_id, insight_type, text, service_line_ids, source, source_touch_id, captured_by_id, ai_extracted)
    values (v_acc, v_contact, o ->> 'insight_type', left(btrim(o ->> 'text'), 500),
            case when jsonb_typeof(o -> 'service_line_ids') = 'array' then array(select jsonb_array_elements_text(o -> 'service_line_ids'))::uuid[] end,
            'Action', v_touch, who, coalesce((o ->> 'ai_extracted')::boolean, false));
    n_ins := n_ins + 1;
  end loop;

  for o in select e from jsonb_array_elements(coalesce(ft -> 'whitespace', '[]'::jsonb)) as x(e) loop
    idx := (o ->> 'from_action_index')::int;
    insert into public.whitespace_map (account_id, service_line_id, status, status_source, competitor_id, est_annual_value_usd, evidence_action_id, last_verified_at)
    values (v_acc, (o ->> 'service_line_id')::uuid, o ->> 'status', coalesce(nullif(o ->> 'status_source', ''), 'rDYK answer'),
            case when money then nullif(o ->> 'competitor_id', '')::uuid end,
            case when money then nullif(o ->> 'est_annual_value_usd', '')::numeric end,
            case when idx is not null and idx >= 0 and idx < coalesce(array_length(action_ids, 1), 0) then action_ids[idx + 1] end, public.today_ist())
    on conflict (account_id, coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), service_line_id) where archived_at is null
    do update set status = excluded.status, status_source = excluded.status_source,
                  competitor_id = coalesce(excluded.competitor_id, public.whitespace_map.competitor_id),
                  est_annual_value_usd = coalesce(excluded.est_annual_value_usd, public.whitespace_map.est_annual_value_usd),
                  evidence_action_id = coalesce(excluded.evidence_action_id, public.whitespace_map.evidence_action_id),
                  last_verified_at = public.today_ist();
    n_ws := n_ws + 1;
  end loop;

  for o in select e from jsonb_array_elements(coalesce(ft -> 'opportunities', '[]'::jsonb)) as x(e) loop
    idx := coalesce((o ->> 'from_action_index')::int, 0);
    if idx < 0 or idx >= coalesce(array_length(action_ids, 1), 0) then raise exception 'BAD_ACTION_INDEX: an opportunity must come from one of the asks'; end if;
    if length(btrim(coalesce(o ->> 'name', ''))) = 0 then raise exception 'BAD_OPPORTUNITY: give the opportunity a name'; end if;
    -- Measurement integrity: origin Outgrow action + source_action_id. Stage is always Identified from a log.
    insert into public.opportunities (name, account_id, primary_contact_id, service_line_id, expansion_lever, origin, source_action_id, surfaced_by_id,
                                      owner_id, stage, estimated_value_usd, value_basis, next_step)
    values (left(btrim(o ->> 'name'), 200), v_acc, v_contact, (o ->> 'service_line_id')::uuid,
            coalesce(nullif(o ->> 'expansion_lever', ''), 'New service line (cross-sell)'), 'Outgrow action', action_ids[idx + 1], who, acc_owner, 'Identified',
            coalesce((o ->> 'estimated_value_usd')::numeric, 0), coalesce(nullif(o ->> 'value_basis', ''), 'Annualised run-rate'), nullif(btrim(o ->> 'next_step'), ''))
    returning opportunity_id into opp_id;
    update public.actions set opportunity_id = opp_id, opportunity_created = true where action_id = action_ids[idx + 1];
    n_opp := n_opp + 1;
  end loop;

  for o in select e from jsonb_array_elements(coalesce(ft -> 'referrals', '[]'::jsonb)) as x(e) loop
    idx := coalesce((o ->> 'from_action_index')::int, 0);
    if idx < 0 or idx >= coalesce(array_length(action_ids, 1), 0) then raise exception 'BAD_ACTION_INDEX: a referral must come from one of the asks'; end if;
    if v_contact is null then raise exception 'REFERRAL_NEEDS_CONTACT: choose the contact who is referring'; end if;
    select action_code into code from public.actions where action_id = action_ids[idx + 1];
    ref_type := case when code = 'OG4.2' then 'External (new logo)' else 'Internal (same account group)' end;
    insert into public.referrals (referral_type, source_action_id, referring_contact_id, referred_name_text, target_account_id, intro_method, promised_by, status, handoff_to_land)
    values (ref_type, action_ids[idx + 1], v_contact, nullif(btrim(o ->> 'referred_name_text'), ''), nullif(o ->> 'target_account_id', '')::uuid,
            nullif(o ->> 'intro_method', ''), nullif(o ->> 'promised_by', '')::date,
            case when length(btrim(coalesce(o ->> 'referred_name_text', ''))) > 0 then 'Named' else 'Asked' end, ref_type = 'External (new logo)')
    returning referral_id into ref_id;
    update public.actions set referral_id = ref_id where action_id = action_ids[idx + 1];
    n_ref := n_ref + 1;
  end loop;

  if jsonb_typeof(ft -> 'share_reading') = 'object' then
    o := ft -> 'share_reading';
    idx := coalesce((o ->> 'from_action_index')::int, 0);
    if idx < 0 or idx >= coalesce(array_length(action_ids, 1), 0) then raise exception 'BAD_ACTION_INDEX: a share reading must come from one of the asks'; end if;
    if v_contact is null then raise exception 'SHARE_NEEDS_CONTACT: choose the contact who gave the number'; end if;
    insert into public.share_of_wallet_readings (account_id, scope, service_line_id, stated_share_pct, stated_by_contact_id, source_action_id, where_rest_goes, reading_date)
    values (v_acc, coalesce(nullif(o ->> 'scope', ''), 'All outsourced engineering'), nullif(o ->> 'service_line_id', '')::uuid,
            (o ->> 'stated_share_pct')::numeric, v_contact, action_ids[idx + 1], nullif(btrim(o ->> 'where_rest_goes'), ''), v_date)
    returning reading_id into sow_id;
    update public.actions set share_reading_id = sow_id where action_id = action_ids[idx + 1];
    n_sow := 1;
  end if;

  if coalesce((t ->> 'success_nominated')::boolean, false) then
    select coalesce(sum(estimated_value_usd), 0) into sum_val from public.actions where touch_id = v_touch and action_code <> 'OG0.1';
    insert into public.success_stories (touch_id, person_id, account_id, service_line_id, story_text, value_usd, status)
    values (v_touch, who, v_acc, coalesce(v_first_sl, v_none_sl), nullif(btrim(t ->> 'note'), ''), sum_val, 'Nominated');
    n_story := 1;
  end if;

  if v_assign is not null then
    update public.assignments set status = 'Done', completed_touch_id = v_touch
    where assignment_id = v_assign and assignee_id = who and status in ('Open', 'Partly done');
    if not found then raise exception 'ASSIGNMENT_MISMATCH: that assignment is not open for this person'; end if;
  end if;

  if v_inbox is not null then
    update public.capture_inbox set status = 'logged', touch_id = v_touch, logged_by_id = me
    where id = v_inbox and from_person_id = who and status = 'new' and (to_manager_id = me or public.is_leader());
    if not found then raise exception 'INBOX_MISMATCH: that note is not waiting for you'; end if;
  end if;

  if jsonb_typeof(p -> 'ai_run_ids') = 'array' then
    update public.ai_runs set accepted = true
    where id = any(array(select jsonb_array_elements_text(p -> 'ai_run_ids'))::uuid[]) and person_id = me;
  end if;

  if who <> me then
    perform public.notify(who, 'logged_for_you', 'A conversation was logged for you', coalesce(nullif(btrim(t ->> 'note'), ''), v_type), '/today');
  end if;

  -- this week's count for the credited person
  w_start := public.week_start_of(v_date);
  select count(*) into w_actions from public.actions where person_id = who and action_date between w_start and w_start + 6 and archived_at is null;
  select count(*) into k from public.actions where touch_id = v_touch;
  select weekly_target into w_target from public.acsia_people where person_id = who;
  w_threshold := least(5, coalesce(w_target, 0));
  w_before := w_actions - k;

  return jsonb_build_object(
    'touch_id', v_touch,
    'action_ids', to_jsonb(action_ids),
    'actions_written', k,
    'created', jsonb_build_object('insights', n_ins, 'whitespace', n_ws, 'opportunities', n_opp, 'referrals', n_ref, 'share_readings', n_sow, 'stories', n_story),
    'warnings', warnings,
    'week', jsonb_build_object('week_start', w_start, 'actions', w_actions, 'target', coalesce(w_target, 0), 'threshold', w_threshold,
                               'participating', coalesce(w_target, 0) > 0 and w_actions >= w_threshold,
                               'just_reached', coalesce(w_target, 0) > 0 and w_before < w_threshold and w_actions >= w_threshold));
end $$;

------------------------------------------------------------------ assignments
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
  insert into public.assignments (week_start, assignee_id, assigned_by_id, contact_id, account_id, opportunity_id, list_id, expected_action_code, suggested_play_id, instruction, due_date, status)
  values (coalesce(nullif(p ->> 'week_start', '')::date, public.week_start_of(public.today_ist())), v_assignee, me, v_contact, v_account,
          nullif(p ->> 'opportunity_id', '')::uuid, nullif(p ->> 'list_id', ''), nullif(p ->> 'expected_action_code', ''), nullif(p ->> 'suggested_play_id', ''),
          left(btrim(p ->> 'instruction'), 500), nullif(p ->> 'due_date', '')::date, 'Open')
  returning assignment_id into v_id;
  if v_assignee <> me then perform public.notify(v_assignee, 'assignment', 'New assignment: ' || cn, left(btrim(p ->> 'instruction'), 140), '/today'); end if;
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
  update public.assignments set
    assignee_id = new_assignee,
    instruction = case when p ? 'instruction' then left(btrim(p ->> 'instruction'), 500) else instruction end,
    due_date = case when p ? 'due_date' then nullif(p ->> 'due_date', '')::date else due_date end,
    suggested_play_id = case when p ? 'suggested_play_id' then nullif(p ->> 'suggested_play_id', '') else suggested_play_id end,
    expected_action_code = case when p ? 'expected_action_code' then nullif(p ->> 'expected_action_code', '') else expected_action_code end
  where assignment_id = p_id;
end $$;

create or replace function public.approve_assignments(p_ids uuid[], p_approve boolean default true) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select a.assignment_id, a.assignee_id, a.instruction, c.first_name || ' ' || c.last_name as cn
           from public.assignments a join public.contacts c on c.contact_id = a.contact_id
           where a.assignment_id = any(p_ids) and a.status = 'Draft' loop
    if not public._can_manage_assignee(r.assignee_id) then continue; end if;
    update public.assignments set status = case when p_approve then 'Open' else 'Dropped' end where assignment_id = r.assignment_id;
    if p_approve then perform public.notify(r.assignee_id, 'assignment', 'New assignment: ' || r.cn, left(r.instruction, 140), '/today'); end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.set_assignment_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare cur record; me uuid := public.current_person_id();
begin
  select assignee_id, status into cur from public.assignments where assignment_id = p_id;
  if not found then raise exception 'NOT_FOUND: assignment'; end if;
  if not (cur.assignee_id = me or public._can_manage_assignee(cur.assignee_id)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_status not in ('Skipped', 'Rolled over', 'Partly done') then raise exception 'BAD_STATUS: use the log to mark an assignment Done'; end if;
  if p_status = 'Skipped' and length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'REASON_REQUIRED: say why it was skipped'; end if;
  if cur.status not in ('Open', 'Partly done') then raise exception 'LOCKED: this assignment is already %', cur.status; end if;
  update public.assignments set status = p_status, skip_reason = case when p_status = 'Skipped' then left(btrim(p_reason), 300) else skip_reason end where assignment_id = p_id;
end $$;

------------------------------------------------------------------ contacts
create or replace function public.upsert_contact(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id();
  v_id uuid := nullif(p ->> 'contact_id', '')::uuid;
  v_acc uuid := nullif(p ->> 'account_id', '')::uuid;
  col text; acc_country text;
  text_cols text[] := array['first_name','last_name','preferred_name','job_title','seniority','function','buying_role','influence_level','decision_authority',
                            'email','phone_office','phone_mobile','messaging_handle','linkedin_url','country','timezone','language_pref','preferred_channel',
                            'legal_basis','contact_status','sentiment'];
  rapport_cols text[] := array['rapport_notes','current_priorities'];
begin
  if me is null or not public.can_log() then raise exception 'NOT_ALLOWED: your role cannot edit contacts' using errcode = '42501'; end if;
  if v_id is null then
    if v_acc is null then raise exception 'BAD_ACCOUNT: choose an account'; end if;
    select country into acc_country from public.accounts where account_id = v_acc and archived_at is null;
    if not found then raise exception 'BAD_ACCOUNT: choose an account'; end if;
    if length(btrim(coalesce(p ->> 'first_name', ''))) = 0 or length(btrim(coalesce(p ->> 'last_name', ''))) = 0 then raise exception 'EMPTY: first and last name are required'; end if;
    insert into public.contacts (account_id, first_name, last_name, country, primary_relationship_owner_id, source, contact_status)
    values (v_acc, btrim(p ->> 'first_name'), btrim(p ->> 'last_name'), coalesce(nullif(p ->> 'country', ''), acc_country), me, 'Delivery', 'Active')
    returning contact_id into v_id;
  else
    perform 1 from public.contacts where contact_id = v_id and archived_at is null;
    if not found then raise exception 'NOT_FOUND: contact'; end if;
  end if;
  foreach col in array text_cols loop
    if p ? col then execute format('update public.contacts set %I = $1 where contact_id = $2', col) using nullif(btrim(p ->> col), ''), v_id; end if;
  end loop;
  if public.can_see_rapport() then
    foreach col in array rapport_cols loop
      if p ? col then execute format('update public.contacts set %I = $1 where contact_id = $2', col) using nullif(btrim(p ->> col), ''), v_id; end if;
    end loop;
    if p ? 'interests' and jsonb_typeof(p -> 'interests') = 'array' then
      update public.contacts set interests = array(select jsonb_array_elements_text(p -> 'interests')) where contact_id = v_id;
    end if;
  end if;
  if p ? 'opt_out_channels' and jsonb_typeof(p -> 'opt_out_channels') = 'array' then
    update public.contacts set opt_out_channels = array(select jsonb_array_elements_text(p -> 'opt_out_channels')) where contact_id = v_id;
  end if;
  if p ? 'relationship_strength' then update public.contacts set relationship_strength = nullif(p ->> 'relationship_strength', '')::int where contact_id = v_id; end if;
  if p ? 'touch_cadence_days' then update public.contacts set touch_cadence_days = nullif(p ->> 'touch_cadence_days', '')::int where contact_id = v_id; end if;
  return v_id;
end $$;

------------------------------------------------------------------ opportunities
create or replace function public.create_opportunity(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_person_id();
  v_acc uuid := nullif(p ->> 'account_id', '')::uuid;
  v_origin text := coalesce(nullif(p ->> 'origin', ''), 'AE-initiated');
  v_src uuid := nullif(p ->> 'source_action_id', '')::uuid;
  v_stage text := coalesce(nullif(p ->> 'stage', ''), 'Identified');
  owner uuid; v_id uuid;
begin
  if me is null or public.is_engineer() or public.is_ceo() then raise exception 'NOT_ALLOWED: your role cannot create opportunities' using errcode = '42501'; end if;
  if public.current_app_role() = 'pm' and v_stage <> 'Identified' then raise exception 'NOT_ALLOWED: project managers can only create Identified opportunities' using errcode = '42501'; end if;
  select account_owner_id into owner from public.accounts where account_id = v_acc and archived_at is null;
  if not found then raise exception 'BAD_ACCOUNT: choose an account'; end if;
  if length(btrim(coalesce(p ->> 'name', ''))) = 0 then raise exception 'EMPTY: name the opportunity'; end if;
  if v_origin = 'Outgrow action' then
    if v_src is null then raise exception 'SOURCE_REQUIRED: an Outgrow opportunity must name the action that surfaced it'; end if;
    perform 1 from public.actions where action_id = v_src and (person_id = me or public.is_leader());
    if not found then raise exception 'BAD_ACTION: you can only source an opportunity from your own action'; end if;
  end if;
  insert into public.opportunities (name, account_id, primary_contact_id, service_line_id, expansion_lever, origin, source_action_id, surfaced_by_id, owner_id, stage,
                                    estimated_value_usd, value_basis, next_step, next_step_date)
  values (left(btrim(p ->> 'name'), 200), v_acc, nullif(p ->> 'primary_contact_id', '')::uuid, (p ->> 'service_line_id')::uuid,
          coalesce(nullif(p ->> 'expansion_lever', ''), 'New service line (cross-sell)'), v_origin, v_src, me,
          coalesce(nullif(p ->> 'owner_id', '')::uuid, owner), v_stage, coalesce((p ->> 'estimated_value_usd')::numeric, 0),
          coalesce(nullif(p ->> 'value_basis', ''), 'Annualised run-rate'), nullif(btrim(p ->> 'next_step'), ''), nullif(p ->> 'next_step_date', '')::date)
  returning opportunity_id into v_id;
  if v_src is not null then update public.actions set opportunity_id = v_id, opportunity_created = true where action_id = v_src; end if;
  return v_id;
end $$;

create or replace function public.set_opportunity_stage(p_id uuid, p_stage text, p_lost_reason text default null, p_next_step text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); o record;
begin
  select owner_id into o from public.opportunities where opportunity_id = p_id and archived_at is null;
  if not found then raise exception 'NOT_FOUND: opportunity'; end if;
  if not (public.is_leader() or (public.current_app_role() in ('ae', 'sdr') and o.owner_id = me)) then
    raise exception 'NOT_ALLOWED: only the owning AE or the Outgrow leader can change the stage' using errcode = '42501';
  end if;
  if p_stage = 'Lost' and length(btrim(coalesce(p_lost_reason, ''))) = 0 then raise exception 'REASON_REQUIRED: choose a lost reason'; end if;
  update public.opportunities set stage = p_stage, lost_reason = case when p_stage = 'Lost' then p_lost_reason else lost_reason end,
         next_step = coalesce(nullif(btrim(p_next_step), ''), next_step) where opportunity_id = p_id;
end $$;

create or replace function public.update_opportunity(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); o record;
begin
  select owner_id into o from public.opportunities where opportunity_id = p_id and archived_at is null;
  if not found then raise exception 'NOT_FOUND: opportunity'; end if;
  if not (public.is_leader() or (public.current_app_role() in ('ae', 'sdr') and o.owner_id = me)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.opportunities set
    name = case when p ? 'name' then left(btrim(p ->> 'name'), 200) else name end,
    estimated_value_usd = case when p ? 'estimated_value_usd' then (p ->> 'estimated_value_usd')::numeric else estimated_value_usd end,
    value_basis = case when p ? 'value_basis' then p ->> 'value_basis' else value_basis end,
    next_step = case when p ? 'next_step' then nullif(btrim(p ->> 'next_step'), '') else next_step end,
    next_step_date = case when p ? 'next_step_date' then nullif(p ->> 'next_step_date', '')::date else next_step_date end,
    decision_expected = case when p ? 'decision_expected' then nullif(p ->> 'decision_expected', '')::date else decision_expected end,
    proposal_sent_date = case when p ? 'proposal_sent_date' then nullif(p ->> 'proposal_sent_date', '')::date else proposal_sent_date end,
    owner_id = case when p ? 'owner_id' and public.is_leader() then nullif(p ->> 'owner_id', '')::uuid else owner_id end
  where opportunity_id = p_id;
end $$;

------------------------------------------------------------------ account edits (owner / leader)
create or replace function public.update_account(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.current_person_id(); a record;
begin
  select account_owner_id, outgrow_owner_id into a from public.accounts where account_id = p_id and archived_at is null;
  if not found then raise exception 'NOT_FOUND: account'; end if;
  if not (public.is_leader() or a.account_owner_id = me or a.outgrow_owner_id = me) then raise exception 'NOT_ALLOWED: only the account owner or the Outgrow leader can edit this account' using errcode = '42501'; end if;
  update public.accounts set
    outgrow_owner_id = case when p ? 'outgrow_owner_id' and public.is_leader() then nullif(p ->> 'outgrow_owner_id', '')::uuid else outgrow_owner_id end,
    tier = case when p ? 'tier' then nullif(p ->> 'tier', '') else tier end,
    tier_override = case when p ? 'tier' then true else tier_override end,
    power_map_status = case when p ? 'power_map_status' then nullif(p ->> 'power_map_status', '') else power_map_status end,
    vendor_panel_status = case when p ? 'vendor_panel_status' then nullif(p ->> 'vendor_panel_status', '') else vendor_panel_status end,
    contract_status = case when p ? 'contract_status' then nullif(p ->> 'contract_status', '') else contract_status end,
    next_planned_touch = case when p ? 'next_planned_touch' then nullif(p ->> 'next_planned_touch', '')::date else next_planned_touch end,
    strategic_notes = case when p ? 'strategic_notes' then nullif(btrim(p ->> 'strategic_notes'), '') else strategic_notes end
  where account_id = p_id;
end $$;

------------------------------------------------------------------ grants: only the client-callable ones
grant execute on function
  public.get_me(), public.mark_welcomed(), public.submit_capture(text, text), public.dismiss_capture(uuid), public.log_conversation(jsonb),
  public.create_assignment(jsonb), public.update_assignment(uuid, jsonb), public.approve_assignments(uuid[], boolean),
  public.set_assignment_status(uuid, text, text), public.upsert_contact(jsonb), public.create_opportunity(jsonb),
  public.set_opportunity_stage(uuid, text, text, text), public.update_opportunity(uuid, jsonb), public.update_account(uuid, jsonb)
  to authenticated;
