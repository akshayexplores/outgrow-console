-- Milestone 2 tests: cron idempotency, nightly refresh, list membership, conversion-rate lock, Friday draft visibility, grants.
-- Same conventions as rls.sql: pure SQL, one transaction, always ends in ROLLBACK via RAISE. Success = exception "M2_TESTS_PASSED n assertions".
-- Precondition: migrations 0001-0017 applied. No real data needed (fixtures are created here and rolled back).

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  perform set_config('t.passed', (coalesce(nullif(current_setting('t.passed', true), ''), '0')::int + 1)::text, true);
end $$;

create temp table personas (k text primary key, sub uuid, email text, person uuid);
grant all on personas to public;

create or replace function pg_temp.exec_as(persona text, sql text) returns text language plpgsql as $$
declare v text; sub_ uuid; em text;
begin
  select p.sub, p.email into sub_, em from pg_temp.personas p where p.k = persona;
  perform set_config('request.jwt.claims', json_build_object('sub', sub_, 'email', em, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute sql into v;
  execute 'reset role';
  return v;
end $$;

create or replace function pg_temp.raises(persona text, sql text, expect text) returns void language plpgsql as $$
declare msg text;
begin
  begin perform pg_temp.exec_as(persona, sql); exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FAIL: expected an error containing [%] as % for: %', expect, persona, sql; end if;
  if position(expect in msg) = 0 then raise exception 'FAIL: as % expected [%] but got [%] for: %', persona, expect, msg, sql; end if;
  perform set_config('t.passed', (coalesce(nullif(current_setting('t.passed', true), ''), '0')::int + 1)::text, true);
end $$;

create or replace function pg_temp.n(persona text, sql text) returns int language sql as $$ select pg_temp.exec_as(persona, sql)::int $$;

do $test$
declare
  j jsonb; v text; acc uuid; c1 uuid; c2 uuid; c3 uuid; o1 uuid; o2 uuid; slA uuid; slB uuid; touch uuid; pm uuid; ldr uuid;
  wk_draft uuid; wk_pub uuid; a_ids uuid[]; i int;
  ceo_p uuid; run1 uuid; run2 uuid; run3 uuid; run4 uuid; run5 uuid; wk date; wk2 date; wk3 date; cl uuid; asg1 uuid; asg2 uuid; asg3 uuid;
begin
  ------------------------------------------------------------------ fixtures
  update public.app_settings set value = 'admin@test.local' where key = 'admin_email';
  update public.app_settings set value = '' where key = 'allowed_email_domain';
  insert into public.service_lines (name, short_code, is_lila, confidence_band, active) values ('AUTOSAR', 'AUT', false, 'LEAD', true), ('LiLA', 'LILA', true, 'LEAD', true);
  select service_line_id into slA from public.service_lines where short_code = 'AUT';
  select service_line_id into slB from public.service_lines where short_code = 'LILA';

  insert into personas (k, sub, email) values ('leader', 'e0000000-0000-0000-0000-000000000008', 'leader@test.local'), ('pm', 'e0000000-0000-0000-0000-000000000002', 'pm@test.local'),
    ('engineer', 'e0000000-0000-0000-0000-000000000001', 'eng@test.local'), ('ceo', 'e0000000-0000-0000-0000-000000000009', 'ceo@test.local');
  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target, show_on_ranked_scorecard, auth_user_id) values
    ('Lena Leader', 'leader@test.local', 'Leadership', 'Outgrow Leader', 'leader', 5, true, 'e0000000-0000-0000-0000-000000000008'),
    ('Priya Pm', 'pm@test.local', 'Project manager', 'Frontline', 'pm', 5, true, 'e0000000-0000-0000-0000-000000000002'),
    ('Ravi Engineer', 'eng@test.local', 'Delivery engineer', 'Frontline', 'engineer', 2, false, 'e0000000-0000-0000-0000-000000000001'),
    ('Carl Ceo', 'ceo@test.local', 'Leadership', 'Owner (CEO)', 'ceo', 0, false, 'e0000000-0000-0000-0000-000000000009');
  update personas p set person = a.person_id from public.acsia_people a where lower(a.email) = p.email;
  select person into pm from personas where k = 'pm';
  select person into ldr from personas where k = 'leader';

  insert into public.accounts (name, account_level, relationship_type, segment, region, country, account_owner_id, tier, track, customer_status, buying_committee_est)
  values ('M2 Account', 'Group', 'Direct customer', 'OEM', 'US', 'US', ldr, 'A - top 5', 'EXPAND', 'Active', 10) returning account_id into acc;
  insert into public.contacts (first_name, last_name, account_id, contact_status, seniority, relationship_strength, touch_cadence_days) values ('Dana', 'Director', acc, 'Active', 'Director', 4, 30) returning contact_id into c1;
  insert into public.contacts (first_name, last_name, account_id, contact_status, seniority, relationship_strength) values ('Eli', 'Engineer', acc, 'Active', 'Engineer', 3) returning contact_id into c2;
  insert into public.contacts (first_name, last_name, account_id, contact_status, seniority, relationship_strength) values ('Mia', 'Manager', acc, 'Active', 'Manager', 3) returning contact_id into c3;
  insert into public.contacts (first_name, last_name, account_id, contact_status, seniority, relationship_strength) values ('Left', 'Company', acc, 'Left company', 'Director', 5);
  insert into public.whitespace_map (account_id, service_line_id, status, status_source) values (acc, slA, 'Buying from Acsia', 'AE judgement'), (acc, slB, 'Buying from Acsia', 'AE judgement');
  insert into public.insights (account_id, insight_type, text, source, captured_by_id, ai_extracted, status, relevant_until) values
    (acc, 'Interest', 'old', 'Action', pm, false, 'Open', public.today_ist() - 1),
    (acc, 'Interest', 'fresh', 'Action', pm, false, 'Open', public.today_ist() + 30),
    (acc, 'Interest', 'undated', 'Action', pm, false, 'Open', null);
  insert into public.list_definitions (list_id, name, entity, rule, active) values
    ('L01', 'Quotes', 'Opportunity', 'r', true), ('L02', 'Pre-quote', 'Opportunity', 'r', true), ('L03', 'Large', 'Contact', 'r', true),
    ('L04', 'Small', 'Contact', 'r', false), ('L05', 'Silent', 'Contact', 'r', true), ('A1', 'Single', 'Contact', 'r', true);
  insert into public.opportunities (name, account_id, service_line_id, expansion_lever, origin, owner_id, stage, estimated_value_usd, value_basis, primary_contact_id, proposal_sent_date)
  values ('Old proposal', acc, slA, 'New service line (cross-sell)', 'AE-initiated', ldr, 'Proposal sent', 1000, 'One-off', c1, public.today_ist() - 60) returning opportunity_id into o1;
  insert into public.opportunities (name, account_id, service_line_id, expansion_lever, origin, owner_id, stage, estimated_value_usd, value_basis, stage_changed_at)
  values ('Stalled', acc, slB, 'New service line (cross-sell)', 'AE-initiated', ldr, 'Qualifying', 1000, 'One-off', now() - interval '40 days') returning opportunity_id into o2;

  ------------------------------------------------------------------ 1. who may call what
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.refresh_derived()', 'execute'), 'authenticated cannot run refresh_derived');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.refresh_list_memberships()', 'execute'), 'anon cannot run refresh_list_memberships');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.claim_job_run(text, text, boolean)', 'execute'), 'authenticated cannot claim a job run');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.analyst_input()', 'execute'), 'authenticated cannot read the analyst input');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.freeze_week(date)', 'execute'), 'authenticated cannot freeze a week directly');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.refresh_derived()', 'execute') and has_function_privilege('service_role', 'public.freeze_week(date)', 'execute'), 'service_role can run the jobs');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.conversion_rates()', 'execute') and not has_function_privilege('anon', 'public.conversion_rates()', 'execute'), 'conversion_rates: signed-in only');

  ------------------------------------------------------------------ 2. cron idempotency
  perform pg_temp.ok(public.claim_job_run('t_daily', '2026-09-29'), 'first claim wins');
  perform pg_temp.ok(not public.claim_job_run('t_daily', '2026-09-29'), 'a running period cannot be claimed twice');
  perform public.finish_job_run('t_daily', '2026-09-29', 'ok', '{"x":1}');
  perform pg_temp.ok(not public.claim_job_run('t_daily', '2026-09-29'), 'a finished period is not re-run by the schedule');
  perform pg_temp.ok((select detail ->> 'x' from public.job_runs where job = 't_daily') = '1' and (select finished_at is not null from public.job_runs where job = 't_daily'), 'finish stores status detail and time');
  perform pg_temp.ok(public.claim_job_run('t_daily', '2026-09-30'), 'a new period is claimable');
  perform public.finish_job_run('t_daily', '2026-09-30', 'error', '{"e":"boom"}');
  perform pg_temp.ok(public.claim_job_run('t_daily', '2026-09-30'), 'a failed period can be retried');
  perform public.finish_job_run('t_daily', '2026-09-30', 'skipped', null);
  perform pg_temp.ok(not public.claim_job_run('t_daily', '2026-09-30'), 'a skipped period stays skipped');
  perform pg_temp.ok(public.claim_job_run('t_daily', '2026-09-30', true), 'force (Run now) always claims');
  update public.job_runs set started_at = now() - interval '1 hour' where job = 't_daily' and period_key = '2026-09-30';
  perform pg_temp.ok(public.claim_job_run('t_daily', '2026-09-30'), 'a run stuck "running" for over 15 minutes can be taken over');
  perform pg_temp.ok((select count(*) from public.job_runs where job = 't_daily') = 2, 'one row per period, never duplicates');

  ------------------------------------------------------------------ 3. nightly derived fields
  j := public.refresh_derived();
  perform pg_temp.ok((j ->> 'accounts_updated')::int = 1, 'refresh_derived updates the account');
  perform pg_temp.ok((select service_lines_bought = 2 and contacts_mapped = 3 and coverage_ratio = 0.3 from public.accounts where account_id = acc), 'service lines bought 2, contacts mapped 3 (left-company excluded), coverage 30%');
  perform pg_temp.ok((select next_touch_due = public.today_ist() + 30 from public.contacts where contact_id = c1), 'next touch due = today + cadence when never touched');
  perform pg_temp.ok((select next_touch_due is null from public.contacts where contact_id = c2), 'no cadence, no next touch date');
  perform pg_temp.ok((select single_thread_risk = false from public.contacts where contact_id = c1), 'three mapped contacts is not single-threaded');
  perform pg_temp.ok((j ->> 'insights_marked_stale')::int = 1 and (select count(*) from public.insights where status = 'Stale') = 1, 'only the expired insight goes stale');
  perform pg_temp.ok((select status = 'Open' from public.insights where text = 'undated') and (select status = 'Open' from public.insights where text = 'fresh'), 'undated and future insights stay open');
  j := public.refresh_derived();
  perform pg_temp.ok((j ->> 'accounts_updated')::int = 0 and (j ->> 'contacts_updated')::int = 0 and (j ->> 'insights_marked_stale')::int = 0, 'refresh_derived is idempotent');
  update public.accounts set buying_committee_est = 2 where account_id = acc;
  perform public.refresh_derived();
  perform pg_temp.ok((select coverage_ratio = 1 from public.accounts where account_id = acc), 'coverage is capped at 100%');

  ------------------------------------------------------------------ 4. list membership
  update public.accounts set buying_committee_est = 10 where account_id = acc;
  perform public.refresh_derived();
  j := public.refresh_list_memberships();
  perform pg_temp.ok((j ->> 'added')::int = 7 and (j ->> 'open')::int = 7 and (j ->> 'exited')::int = 0, format('first run: L01 x1, L02 x1, L03 x2, L05 x3 = 7 members (got %s)', j));
  perform pg_temp.ok((select count(*) from public.list_memberships where list_id = 'L01' and opportunity_id = o1 and contact_id = c1 and reason like 'Proposal out 60 days%') = 1, 'L01: proposal out 60 days with no follow-up');
  perform pg_temp.ok((select contact_id = c1 from public.list_memberships where list_id = 'L02' and opportunity_id = o2), 'L02: an opportunity with no contact falls back to the warmest contact');
  perform pg_temp.ok((select count(*) from public.list_memberships where list_id = 'L03') = 2 and not exists (select 1 from public.list_memberships where list_id = 'L03' and contact_id = c2), 'L03: senior + warm contacts only (engineer excluded)');
  perform pg_temp.ok(not exists (select 1 from public.list_memberships where list_id = 'L04'), 'inactive lists produce no members');
  perform pg_temp.ok(not exists (select 1 from public.list_memberships where list_id = 'A1'), 'A1: 30% coverage is not single-threaded');
  perform pg_temp.ok((select count(*) from public.list_memberships where list_id = 'L05' and reason = 'No proactive call yet') = 3, 'L05: silent contacts, never called');
  j := public.refresh_list_memberships();
  perform pg_temp.ok((j ->> 'added')::int = 0 and (j ->> 'exited')::int = 0 and (j ->> 'open')::int = 7, 'second run changes nothing');

  -- a proactive call with a proposal chase: L01 (recent OG2.3) and L05 (called today) both drop c1/o1
  insert into public.touches (touch_date, person_id, logged_by_id, account_id, contact_id, touch_type, channel, capture_method)
  values (public.today_ist(), pm, pm, acc, c1, 'Proactive call', 'Call', 'Web') returning touch_id into touch;
  insert into public.actions (touch_id, action_code, service_line_id, estimated_value_usd, opportunity_id) values (touch, 'OG2.3', slA, 0, o1);
  j := public.refresh_list_memberships();
  perform pg_temp.ok((j ->> 'exited')::int = 2 and (j ->> 'open')::int = 5, format('a chase and a call take c1 off L01 and L05 (got %s)', j));
  perform pg_temp.ok((select exited_at = public.today_ist() from public.list_memberships where list_id = 'L01' and opportunity_id = o1), 'exit stamps today, history is kept');
  update public.list_definitions set active = false where list_id = 'L03';
  j := public.refresh_list_memberships();
  perform pg_temp.ok((j ->> 'exited')::int = 2, 'switching a list off retires its members');

  insert into public.assignments (week_start, assignee_id, assigned_by_id, contact_id, account_id, instruction, status)
  values (public.week_start_of(public.today_ist()), pm, ldr, c2, acc, 'Call Eli', 'Draft');
  perform public.refresh_list_memberships();
  perform pg_temp.ok((select assigned_this_week from public.list_memberships where list_id = 'L05' and contact_id = c2 and exited_at is null), 'assigned_this_week follows this week''s assignments');
  perform pg_temp.ok(not (select assigned_this_week from public.list_memberships where list_id = 'L05' and contact_id = c3 and exited_at is null), 'and stays false for people nobody has been asked to call');
  update public.assignments set status = 'Dropped' where contact_id = c2;
  perform public.refresh_list_memberships();
  perform pg_temp.ok(not (select assigned_this_week from public.list_memberships where list_id = 'L05' and contact_id = c2 and exited_at is null), 'a dropped assignment no longer counts');

  ------------------------------------------------------------------ 5. conversion rates stay locked until week 12
  perform pg_temp.ok(public.programme_week() between 1 and 2, 'programme week is 1 with one touch today');
  perform pg_temp.raises('leader', 'select count(*)::text from public.conversion_rates()', 'LOCKED');
  perform pg_temp.raises('ceo', 'select count(*)::text from public.conversion_rates()', 'LOCKED');
  perform pg_temp.raises('engineer', 'select count(*)::text from public.conversion_rates()', 'NOT_ALLOWED');
  perform pg_temp.raises('pm', 'select count(*)::text from public.conversion_rates()', 'NOT_ALLOWED');

  update public.app_settings set value = (public.today_ist() - 84)::text where key = 'programme_start';
  perform pg_temp.ok(public.programme_week() = 13, 'programme week 13 when the programme started 12 weeks ago');
  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.conversion_rates()') >= 1, 'leader can read rates from week 12');
  perform pg_temp.ok(pg_temp.n('ceo', 'select count(*) from public.conversion_rates()') >= 1, 'CEO can read rates from week 12');
  perform pg_temp.raises('pm', 'select count(*)::text from public.conversion_rates()', 'NOT_ALLOWED');
  perform pg_temp.ok((select not enough_data and rate is null from public.conversion_rates() where action_code = 'OG2.3'), 'under 30 actions: rate withheld');

  insert into public.touches (touch_date, person_id, logged_by_id, account_id, contact_id, touch_type, channel, capture_method)
  values (public.today_ist(), pm, pm, acc, c3, 'Scheduled meeting', 'Teams', 'Web') returning touch_id into touch;
  insert into public.actions (touch_id, action_code, service_line_id, estimated_value_usd) select touch, 'OG1.1', slA, 0 from generate_series(1, 30);
  select array_agg(action_id) into a_ids from (select action_id from public.actions where action_code = 'OG1.1' and touch_id = touch limit 3) s;
  for i in 1..3 loop
    insert into public.opportunities (name, account_id, service_line_id, expansion_lever, origin, source_action_id, owner_id, stage, estimated_value_usd, value_basis)
    values ('From DYK ' || i, acc, slA, 'New service line (cross-sell)', 'Outgrow action', a_ids[i], ldr, 'Identified', 0, 'One-off');
  end loop;
  perform pg_temp.ok((select actions = 30 and opportunities = 3 and rate = 0.1 and enough_data from public.conversion_rates() where action_code = 'OG1.1'), '30 DYKs, 3 traced opportunities = 10%');
  perform pg_temp.ok(not exists (select 1 from public.conversion_rates() where action_code = 'OG0.1'), 'the code-added proactive action is never a conversion candidate');
  j := public.analyst_input();
  perform pg_temp.ok((select (x ->> 'actions')::int = 30 and (x ->> 'opportunities')::int = 3 and (x ->> 'enough_data')::boolean and (x ->> 'rate')::numeric = 0.1
                      from jsonb_array_elements(j -> 'by_code') x where x ->> 'code' = 'OG1.1'), 'analyst: same window and same 10% as conversion_rates()');
  perform pg_temp.ok((j ->> 'rates_unlocked')::boolean, 'analyst: rates unlocked in week 13');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j -> 'by_code') x where x ->> 'code' = 'OG0.1'), 'analyst: OG0.1 is never a conversion candidate');
  perform pg_temp.ok((select (x ->> 'count')::int = 3 from jsonb_array_elements(j -> 'opps_by_stage') x where x ->> 'stage' = 'Identified'), 'analyst: opportunities by stage come from the same window');
  update public.app_settings set value = to_char(public.today_ist() - 7, 'YYYY-MM-DD') where key = 'programme_start';
  perform pg_temp.ok(not (public.analyst_input() ->> 'rates_unlocked')::boolean and (select (x ->> 'rate') is null from jsonb_array_elements(public.analyst_input() -> 'by_code') x where x ->> 'code' = 'OG1.1'), 'analyst: no rate before week 12');
  update public.app_settings set value = to_char(public.today_ist() - 84, 'YYYY-MM-DD') where key = 'programme_start';
  update public.actions set is_example = true where action_code = 'OG1.1';
  perform pg_temp.ok(not exists (select 1 from public.conversion_rates() where action_code = 'OG1.1'), 'demo (example) actions never count toward measurement');

  ------------------------------------------------------------------ 6. analyst input: counts only
  j := public.analyst_input();
  perform pg_temp.ok((j ->> 'programme_week')::int = 13 and jsonb_typeof(j -> 'actions_by_code') = 'array', 'analyst input has the week and per-code counts');
  perform pg_temp.ok(j::text !~* '(usd|value|email|revenue|competitor)', 'analyst input carries no money, names or contact details');

  ------------------------------------------------------------------ 7. the operator's Friday draft is for the exec only
  insert into public.scorecard_weeks (week_start, status, ai_draft) values ('2026-09-21', 'Draft', '{"commentary":"draft one","story":"s"}') returning week_id into wk_draft;
  insert into public.scorecard_weeks (week_start, status, published_at, ai_draft) values ('2026-09-14', 'Published', now(), '{"commentary":"published draft"}') returning week_id into wk_pub;
  perform pg_temp.ok(pg_temp.exec_as('leader', format('select ai_draft ->> ''commentary'' from public.scorecard_weeks_safe where week_id = %L', wk_draft)) = 'draft one', 'leader sees the operator draft');
  perform pg_temp.ok(pg_temp.exec_as('ceo', format('select ai_draft ->> ''commentary'' from public.scorecard_weeks_safe where week_id = %L', wk_draft)) = 'draft one', 'CEO sees the operator draft');
  perform pg_temp.ok(pg_temp.n('pm', format('select count(*) from public.scorecard_weeks_safe where week_id = %L', wk_draft)) = 0, 'PM cannot see an unpublished week at all');
  perform pg_temp.ok(pg_temp.n('pm', format('select count(*) from public.scorecard_weeks_safe where week_id = %L', wk_pub)) = 1, 'PM sees a published week');
  perform pg_temp.ok(pg_temp.n('pm', format('select count(*) from public.scorecard_weeks_safe where week_id = %L and ai_draft is not null', wk_pub)) = 0, 'but never the operator draft behind it');
  perform pg_temp.ok(pg_temp.n('engineer', format('select count(*) from public.scorecard_weeks_safe where week_id = %L and ai_draft is not null', wk_pub)) = 0, 'nor an engineer');

  ------------------------------------------------------------------ 8. Friday freeze keeps working for the service role
  perform pg_temp.ok(public.freeze_week('2026-09-21') = wk_draft, 'freeze_week refreshes an unpublished draft week');
  perform pg_temp.ok((select ai_draft ->> 'commentary' from public.scorecard_weeks where week_id = wk_draft) = 'draft one', 'freezing does not wipe the operator draft');


  ------------------------------------------------------------------ 9. the Monday planner's drafts (migration 0016)
  select person into ceo_p from personas where k = 'ceo';
  select contact_id into cl from public.contacts where contact_status = 'Left company' and account_id = acc limit 1;
  wk := public.week_start_of(public.today_ist()); wk2 := wk + 7; wk3 := wk + 14;
  insert into public.ai_runs (job, model, status) values ('plan', 'test/model', 'ok') returning id into run1;

  perform pg_temp.raises('pm', format('select public.save_planned_assignments(%L, null, ''[]''::jsonb)::text', wk), 'permission denied');
  perform pg_temp.raises('leader', format('select public.save_planned_assignments(%L, null, ''[]''::jsonb)::text', wk), 'permission denied');

  j := public.save_planned_assignments(wk, run1, jsonb_build_array(
    jsonb_build_object('assignee_id', pm, 'contact_id', c1, 'instruction', 'Ask Dana where the proposal stands.', 'why_now', 'Proposal waiting, chase it right now please', 'list_id', 'L01', 'expected_action_code', 'OG2.3', 'suggested_play_id', 'NO-SUCH-PLAY'),
    jsonb_build_object('assignee_id', pm, 'contact_id', c2, 'instruction', 'Ask Eli what else they are working on.', 'expected_action_code', 'OG9.9', 'list_id', 'NOT-A-LIST'),
    jsonb_build_object('assignee_id', pm, 'contact_id', c3, 'instruction', 'Ask Mia who else we could help.'),
    jsonb_build_object('assignee_id', ldr, 'contact_id', c1, 'instruction', 'Same contact, a second person'),
    jsonb_build_object('assignee_id', pm, 'contact_id', cl, 'instruction', 'This contact left the company'),
    jsonb_build_object('assignee_id', ceo_p, 'contact_id', c2, 'instruction', 'Target zero people are not on the roster for actions'),
    jsonb_build_object('assignee_id', gen_random_uuid(), 'contact_id', c2, 'instruction', 'Nobody by this id'),
    jsonb_build_object('assignee_id', pm, 'contact_id', c2, 'instruction', '   ')));
  perform pg_temp.ok((j ->> 'inserted')::int = 3 and (j ->> 'skipped')::int = 5, 'planner: 3 valid drafts saved, 5 unsafe rows refused (got ' || j::text || ')');
  perform pg_temp.ok((select count(*) from public.assignments where week_start = wk and operator_draft and status = 'Draft' and ai_run_id = run1) = 3, 'planner drafts are Draft, flagged, and tied to the AI run');
  perform pg_temp.ok((select assigned_by_id from public.assignments where week_start = wk and contact_id = c1 and operator_draft) = ldr, 'a draft with no manager is attributed to the leader');
  perform pg_temp.ok((select length(why_now) <= 60 from public.assignments where week_start = wk and contact_id = c1 and operator_draft), 'why-now is trimmed to fit');
  perform pg_temp.ok((select expected_action_code is null and list_id is null from public.assignments where week_start = wk and contact_id = c2 and operator_draft), 'an unknown action code or list id is dropped, not saved');
  perform pg_temp.ok((select suggested_play_id is null from public.assignments where week_start = wk and contact_id = c1 and operator_draft), 'an unknown play is dropped, not saved');
  perform pg_temp.ok((select due_date = wk + 4 from public.assignments where week_start = wk and contact_id = c1 and operator_draft), 'drafts fall due on Friday');
  perform pg_temp.ok(not exists (select 1 from public.list_memberships m where m.contact_id = c1 and m.exited_at is null and not coalesce(m.assigned_this_week, false)), 'lists show the contact as assigned this week');

  -- approving all three: the run counts as accepted
  select array_agg(assignment_id) into a_ids from public.assignments where week_start = wk and operator_draft;
  perform pg_temp.ok(pg_temp.n('leader', format('select public.approve_assignments(%L::uuid[], true)', a_ids)) = 3, 'a leader approves the three drafts');
  perform pg_temp.ok((select accepted from public.ai_runs where id = run1), 'run accepted once all its drafts were approved');
  perform pg_temp.ok((select count(*) from public.assignments where week_start = wk and operator_draft and status = 'Open') = 3, 'approved drafts are Open');

  -- redraft replaces only the operator's own Draft rows and marks the old run as not accepted
  insert into public.ai_runs (job, model, status) values ('plan', 'test/model', 'ok') returning id into run2;
  insert into public.ai_runs (job, model, status) values ('plan', 'test/model', 'ok') returning id into run3;
  j := public.save_planned_assignments(wk2, run2, jsonb_build_array(jsonb_build_object('assignee_id', pm, 'contact_id', c1, 'instruction', 'First idea for next week')));
  perform pg_temp.ok((j ->> 'inserted')::int = 1 and (j ->> 'replaced')::int = 0, 'first plan for next week saved');
  insert into public.assignments (week_start, assignee_id, assigned_by_id, contact_id, account_id, instruction, status) values (wk2, pm, ldr, c3, acc, 'Written by hand', 'Draft');
  j := public.save_planned_assignments(wk2, run3, jsonb_build_array(jsonb_build_object('assignee_id', pm, 'contact_id', c2, 'instruction', 'Second idea for next week')), array[pm]);
  perform pg_temp.ok((j ->> 'replaced')::int = 1 and (j ->> 'inserted')::int = 1, 'redraft replaced one operator draft and added one');
  perform pg_temp.ok((select status from public.assignments where week_start = wk2 and contact_id = c1 and operator_draft) = 'Dropped', 'the earlier operator draft is dropped');
  perform pg_temp.ok((select status from public.assignments where week_start = wk2 and contact_id = c3 and not operator_draft) = 'Draft', 'a draft written by hand is never replaced');
  perform pg_temp.ok((select accepted from public.ai_runs where id = run2) is false, 'the replaced run counts as not accepted');

  -- partly kept: half or more kept = accepted; fewer = not accepted
  insert into public.ai_runs (job, model, status) values ('plan', 'test/model', 'ok') returning id into run4;
  insert into public.ai_runs (job, model, status) values ('plan', 'test/model', 'ok') returning id into run5;
  j := public.save_planned_assignments(wk3, run4, jsonb_build_array(
    jsonb_build_object('assignee_id', pm, 'contact_id', c1, 'instruction', 'Keep this one'), jsonb_build_object('assignee_id', pm, 'contact_id', c2, 'instruction', 'Drop this one')));
  select assignment_id into asg1 from public.assignments where week_start = wk3 and contact_id = c1 and operator_draft;
  select assignment_id into asg2 from public.assignments where week_start = wk3 and contact_id = c2 and operator_draft;
  perform pg_temp.n('leader', format('select public.approve_assignments(array[%L]::uuid[], true)', asg1));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run4) is null, 'a run is undecided while a draft is still waiting');
  perform pg_temp.n('leader', format('select public.approve_assignments(array[%L]::uuid[], false)', asg2));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run4) is true, 'one of two kept: accepted');
  j := public.save_planned_assignments(wk3 + 7, run5, jsonb_build_array(jsonb_build_object('assignee_id', pm, 'contact_id', c1, 'instruction', 'Will be dropped')));
  select assignment_id into asg3 from public.assignments where week_start = wk3 + 7 and operator_draft;
  perform pg_temp.n('leader', format('select public.approve_assignments(array[%L]::uuid[], false)', asg3));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run5) is false, 'all dropped: not accepted');
  perform pg_temp.ok(pg_temp.n('engineer', format('select public.approve_assignments(array[%L]::uuid[], true)', asg1)) = 0, 'an engineer cannot approve anything');

  -- accepted / not accepted for single-answer jobs
  insert into public.ai_runs (job, model, status, person_id) values ('guard', 'test/model', 'ok', pm) returning id into run1;
  insert into public.ai_runs (job, model, status) values ('score', 'test/model', 'ok') returning id into run2;
  perform pg_temp.exec_as('engineer', format('select public.mark_ai_run_accepted(%L, true)::text', run1));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run1) is null, 'someone else cannot mark my run');
  perform pg_temp.exec_as('pm', format('select public.mark_ai_run_accepted(%L, true)::text', run1));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run1) is true, 'the person who ran it can mark it accepted');
  perform pg_temp.exec_as('pm', format('select public.mark_ai_run_accepted(%L, true)::text', run2));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run2) is null, 'a PM cannot mark the exec scorecard draft');
  perform pg_temp.exec_as('ceo', format('select public.mark_ai_run_accepted(%L, true)::text', run2));
  perform pg_temp.ok((select accepted from public.ai_runs where id = run2) is true, 'the CEO can mark the Friday draft accepted');

  -- the Operator screen's numbers are for the leader (and admin) only
  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.ai_dashboard(30) where job = ''plan'' and runs >= 5') = 1, 'leader sees per-job counts');
  perform pg_temp.raises('pm', 'select count(*)::text from public.ai_dashboard(30)', 'NOT_ALLOWED');
  perform pg_temp.raises('ceo', 'select count(*)::text from public.ai_dashboard(30)', 'NOT_ALLOWED');
  perform pg_temp.raises('pm', 'select public.ai_month_cost()::text', 'NOT_ALLOWED');
  perform pg_temp.ok(pg_temp.exec_as('leader', 'select public.ai_month_cost()::text')::numeric >= 0, 'leader sees the month spend');

  raise exception 'M2_TESTS_PASSED % assertions', coalesce(nullif(current_setting('t.passed', true), ''), '0');
end $test$;
