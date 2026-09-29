-- RLS / access-control / business-rule tests. Pure SQL so the SAME file runs locally (psql) and against the live Supabase project
-- (via execute_sql). Everything happens in one transaction that always ends in ROLLBACK (RAISE at the end), so no data is left behind.
-- Success is reported as an exception whose message starts with "RLS_TESTS_PASSED".  Any failure is an exception starting with "FAIL:".
-- Precondition: migrations applied; NO real data required (fixtures are created here and rolled back).

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
  if persona = 'anon' then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
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
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;

do $test$
declare
  r record; v text; j jsonb; vw text;
  acc1 uuid; acc2 uuid; c1 uuid; c2 uuid; slN uuid; slA uuid; slB uuid; prog uuid; comp uuid; opp1 uuid; wk_pub uuid; wk_draft uuid; touchE uuid; touchP uuid; assign1 uuid;
  restricted_ok text[] := array['revenue_periods','vendor_presence','competitors','share_of_wallet_readings'];  -- wholly restricted: plain RLS, engineer must see 0 rows
  cnt int;
begin
  ------------------------------------------------------------------ fixtures (as the table owner)
  update public.app_settings set value = 'admin@test.local' where key = 'admin_email';
  update public.app_settings set value = '' where key = 'allowed_email_domain';

  insert into public.service_lines (name, short_code, is_lila, confidence_band, active) values
    ('None / relationship only', 'NONE', false, 'LEAD', true), ('AUTOSAR', 'AUT', false, 'LEAD', true), ('LiLA (agentic AI platform)', 'LILA', true, 'LEAD', true);
  select service_line_id into slN from public.service_lines where short_code = 'NONE';
  select service_line_id into slA from public.service_lines where short_code = 'AUT';
  select service_line_id into slB from public.service_lines where short_code = 'LILA';

  insert into personas (k, sub, email) values
    ('engineer', 'e0000000-0000-0000-0000-000000000001', 'eng@test.local'), ('pm', 'e0000000-0000-0000-0000-000000000002', 'pm@test.local'),
    ('lead', 'e0000000-0000-0000-0000-000000000003', 'lead@test.local'), ('ae', 'e0000000-0000-0000-0000-000000000004', 'ae@test.local'),
    ('sdr', 'e0000000-0000-0000-0000-000000000005', 'sdr@test.local'), ('presales', 'e0000000-0000-0000-0000-000000000006', 'presales@test.local'),
    ('leader', 'e0000000-0000-0000-0000-000000000008', 'leader@test.local'), ('ceo', 'e0000000-0000-0000-0000-000000000009', 'ceo@test.local'),
    ('other_lead', 'e0000000-0000-0000-0000-00000000000a', 'lead2@test.local'), ('other_eng', 'e0000000-0000-0000-0000-00000000000b', 'eng2@test.local'),
    ('admin', 'ad000000-0000-0000-0000-000000000001', 'admin@test.local'), ('stranger', '50000000-0000-0000-0000-000000000001', 'nobody@test.local'),
    ('anon', '00000000-0000-0000-0000-000000000000', 'anon@test.local');

  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target, show_on_ranked_scorecard, auth_user_id, manager_id) values
    ('Lead Meera', 'lead@test.local', 'Delivery lead', 'Team manager', 'delivery_lead', 5, true, 'e0000000-0000-0000-0000-000000000003', null),
    ('Other Lead', 'lead2@test.local', 'Delivery lead', 'Team manager', 'delivery_lead', 5, true, 'e0000000-0000-0000-0000-00000000000a', null);
  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target, show_on_ranked_scorecard, auth_user_id, manager_id)
  select 'Ravi Engineer', 'eng@test.local', 'Delivery engineer', 'Frontline', 'engineer', 2, false, 'e0000000-0000-0000-0000-000000000001'::uuid, person_id from public.acsia_people where email = 'lead@test.local'
  union all select 'Priya Pm', 'pm@test.local', 'Project manager', 'Frontline', 'pm', 5, true, 'e0000000-0000-0000-0000-000000000002'::uuid, person_id from public.acsia_people where email = 'lead@test.local'
  union all select 'Other Engineer', 'eng2@test.local', 'Delivery engineer', 'Frontline', 'engineer', 2, false, 'e0000000-0000-0000-0000-00000000000b'::uuid, person_id from public.acsia_people where email = 'lead2@test.local';
  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target, show_on_ranked_scorecard, auth_user_id) values
    ('Arjun Ae', 'ae@test.local', 'Account executive', 'Frontline', 'ae', 15, true, 'e0000000-0000-0000-0000-000000000004'),
    ('Sam Sdr', 'sdr@test.local', 'SDR', 'Frontline', 'sdr', 10, true, 'e0000000-0000-0000-0000-000000000005'),
    ('Pia Presales', 'presales@test.local', 'Pre-sales', 'Supporting', 'presales', 5, true, 'e0000000-0000-0000-0000-000000000006'),
    ('Lena Leader', 'leader@test.local', 'Leadership', 'Outgrow Leader', 'leader', 5, true, 'e0000000-0000-0000-0000-000000000008'),
    ('Carl Ceo', 'ceo@test.local', 'Leadership', 'Owner (CEO)', 'ceo', 0, false, 'e0000000-0000-0000-0000-000000000009');
  update personas p set person = a.person_id from public.acsia_people a where lower(a.email) = p.email;
  update public.acsia_people set is_participant = false where app_role = 'ceo';

  insert into public.accounts (name, account_level, relationship_type, segment, region, country, account_owner_id, tier, ttm_billed_usd, lifetime_billed_usd, revenue_trend, ext_eng_spend_usd, share_of_wallet_pct, strategic_notes)
  values ('Flex Test US', 'Group', 'Direct customer', 'OEM', 'US', 'US', (select person from personas where k = 'ae'), 'A - top 5', 900000, 5000000, 'Growing', 7000000, 12.5, 'secret plan') returning account_id into acc1;
  insert into public.accounts (name, account_level, relationship_type, segment, region, country, account_owner_id, tier, ttm_billed_usd)
  values ('Bertrandt Test DE', 'Group', 'Direct customer', 'Tier-1', 'Germany', 'DE', (select person from personas where k = 'ae'), 'C - foothold', 100000) returning account_id into acc2;
  insert into public.contacts (first_name, last_name, account_id, contact_status, country, email, phone_mobile, rapport_notes, interests, opt_out_channels, relationship_strength)
  values ('Dana', 'Ruiz', acc1, 'Active', 'US', 'dana@flex.test', '+1555', 'loves cricket', array['cricket'], null, 4) returning contact_id into c1;
  insert into public.contacts (first_name, last_name, account_id, contact_status, country, email, rapport_notes, opt_out_channels, relationship_strength)
  values ('Klaus', 'Berger', acc2, 'Active', 'DE', 'klaus@b.test', 'hikes', array['WhatsApp'], 3) returning contact_id into c2;
  insert into public.channel_rules (geography, primary_channel, follow_up_channel, avoid, blocked_channels, country_codes)
  values ('Germany', 'Call', 'Teams', 'Unsolicited SMS to personal mobiles', array['SMS','WhatsApp'], array['DE']);
  insert into public.programmes (name, contracting_account_id, status, delivery_lead_id, current_headcount, monthly_run_rate_usd)
  values ('Prog One', acc1, 'Active', (select person from personas where k = 'lead'), 12, 80000) returning programme_id into prog;
  insert into public.programme_team (programme_id, person_id) values (prog, (select person from personas where k = 'engineer'));
  insert into public.org_units (account_id, name, function, known_budget_usd) values (acc1, 'V&V', 'V&V / Test', 250000);
  insert into public.org_units (account_id, name, function, known_budget_usd) values (acc2, 'Cockpit', 'Cockpit / HMI / IVI', 99000);
  insert into public.revenue_periods (programme_id, account_id, period_month, billed_amount, currency, billed_amount_usd) values (prog, acc1, '2026-08-01', 80000, 'USD', 80000);
  insert into public.competitors (name, competitor_type, notes) values ('Rival GmbH', 'Engineering services provider', 'cheap') returning competitor_id into comp;
  insert into public.vendor_presence (account_id, competitor_id) values (acc1, comp);
  insert into public.opportunities (name, account_id, service_line_id, expansion_lever, origin, owner_id, stage, estimated_value_usd, value_basis, competitor_ids)
  values ('Big deal', acc1, slA, 'New service line (cross-sell)', 'AE-initiated', (select person from personas where k = 'ae'), 'Proposal sent', 500000, 'One-off', array[comp]) returning opportunity_id into opp1;
  insert into public.whitespace_map (account_id, service_line_id, status, status_source, competitor_id, est_annual_value_usd)
  values (acc1, slA, 'Held by competitor', 'rDYK answer', comp, 300000);
  insert into public.proof_points (title, internal_statement, external_statement, service_line_ids, approval_status)
  values ('Proof', 'BMW bought LiLA', 'A German OEM bought LiLA', array[slB], 'Approved - internal');
  insert into public.plays (play_id, play_type, action_code, title, script, priority, requires_signoff, approval_status)
  values ('DYK-T1', 'DYK', 'OG1.1', 'Approved play', 'script', '1 - Lead with it', false, 'Approved - internal'), ('DYK-T2', 'DYK', 'OG1.1', 'Draft play', 'script', '1 - Lead with it', true, 'Draft');
  insert into public.insights (account_id, insight_type, text, source, captured_by_id, ai_extracted, status) values
    (acc1, 'Interest', 'engineer insight', 'Action', (select person from personas where k = 'engineer'), false, 'Open'),
    (acc1, 'Interest', 'pm insight', 'Action', (select person from personas where k = 'pm'), false, 'Open'),
    (acc1, 'Rate comparison', 'competitor rate insight', 'Action', (select person from personas where k = 'ae'), false, 'Open');
  insert into public.touches (touch_date, person_id, logged_by_id, account_id, touch_type, channel, capture_method)
  values (public.today_ist(), (select person from personas where k = 'engineer'), (select person from personas where k = 'engineer'), acc1, 'Scheduled meeting', 'Teams', 'Web') returning touch_id into touchE;
  insert into public.touches (touch_date, person_id, logged_by_id, account_id, touch_type, channel, capture_method)
  values (public.today_ist(), (select person from personas where k = 'pm'), (select person from personas where k = 'pm'), acc1, 'Scheduled meeting', 'Teams', 'Web') returning touch_id into touchP;
  insert into public.actions (touch_id, action_code, service_line_id, estimated_value_usd) values (touchE, 'OG1.1', slA, 111), (touchP, 'OG1.2', slB, 222);
  insert into public.scorecard_weeks (week_start, status, total_actions, est_value_surfaced_usd, published_at) values ('2026-09-14', 'Published', 10, 12345, now()) returning week_id into wk_pub;
  insert into public.scorecard_weeks (week_start, status, total_actions, est_value_surfaced_usd) values ('2026-09-21', 'Draft', 3, 999) returning week_id into wk_draft;
  insert into public.success_stories (touch_id, person_id, account_id, service_line_id, story_text, value_usd, status)
  values (touchE, (select person from personas where k = 'engineer'), acc1, slA, 'engineer story', 5000, 'Featured');

  insert into public.ai_routes (job, primary_model, human_role) values ('capture', 'x/y', 'Suggests');
  perform set_config('t.acc1', acc1::text, true); perform set_config('t.acc2', acc2::text, true);
  perform set_config('t.c1', c1::text, true); perform set_config('t.c2', c2::text, true);
  perform set_config('t.slN', slN::text, true); perform set_config('t.slA', slA::text, true); perform set_config('t.slB', slB::text, true);
  perform set_config('t.opp1', opp1::text, true); perform set_config('t.wk_pub', wk_pub::text, true); perform set_config('t.comp', comp::text, true);
  perform set_config('t.pm', (select person from personas where k = 'pm')::text, true);
  perform set_config('t.eng', (select person from personas where k = 'engineer')::text, true);
  perform set_config('t.eng2', (select person from personas where k = 'other_eng')::text, true);
  perform set_config('t.lead', (select person from personas where k = 'lead')::text, true);
  perform set_config('t.lead2', (select person from personas where k = 'other_lead')::text, true);
  perform set_config('t.ae', (select person from personas where k = 'ae')::text, true);
  perform set_config('t.leader', (select person from personas where k = 'leader')::text, true);

  ------------------------------------------------------------------ 1. sign-up gate (hook)
  perform pg_temp.ok(public.hook_before_user_created('{"user":{"email":"Admin@Test.Local"}}'::jsonb) = '{}'::jsonb, 'hook: admin email allowed (case-insensitive)');
  perform pg_temp.ok(public.hook_before_user_created('{"user":{"email":"pm@test.local"}}'::jsonb) = '{}'::jsonb, 'hook: roster email allowed');
  j := public.hook_before_user_created('{"user":{"email":"stranger@test.local"}}'::jsonb);
  perform pg_temp.ok((j -> 'error' ->> 'http_code') = '403' and (j -> 'error' ->> 'message') like '%has not been added yet%', 'hook: unknown email rejected with friendly 403');
  perform pg_temp.ok(public.hook_before_user_created('{"user":{}}'::jsonb) ? 'error', 'hook: missing email rejected');
  update public.acsia_people set active = false where email = 'pm@test.local';
  perform pg_temp.ok(public.hook_before_user_created('{"user":{"email":"pm@test.local"}}'::jsonb) ? 'error', 'hook: deactivated employee rejected');
  update public.acsia_people set active = true where email = 'pm@test.local';
  update public.app_settings set value = 'test.local' where key = 'allowed_email_domain';
  perform pg_temp.ok(public.hook_before_user_created('{"user":{"email":"x@evil.com"}}'::jsonb) -> 'error' ->> 'message' = 'Use your company email address.', 'hook: domain gate');
  update public.app_settings set value = '' where key = 'allowed_email_domain';
  perform pg_temp.raises('anon', $$select public.hook_before_user_created('{"user":{"email":"a@b.c"}}'::jsonb)::text$$, 'permission denied');
  perform pg_temp.raises('pm', $$select public.hook_before_user_created('{"user":{"email":"a@b.c"}}'::jsonb)::text$$, 'permission denied');

  ------------------------------------------------------------------ 2. anon and strangers see nothing
  perform pg_temp.raises('anon', 'select count(*) from public.accounts_safe', 'permission denied');
  perform pg_temp.raises('anon', 'select count(*) from public.touches', 'permission denied');
  perform pg_temp.raises('anon', 'select public.get_me()::text', 'permission denied');
  perform pg_temp.ok(pg_temp.n('stranger', 'select count(*) from public.accounts_safe') = 0, 'stranger (no roster row) sees no accounts');
  perform pg_temp.ok(pg_temp.n('stranger', 'select count(*) from public.plays') = 0, 'stranger sees no plays');
  perform pg_temp.ok(pg_temp.exec_as('stranger', 'select public.get_me()::text') is null, 'stranger get_me() is null');
  perform pg_temp.raises('stranger', $$select public.log_conversation('{}'::jsonb)::text$$, 'NO_PERSON');

  ------------------------------------------------------------------ 3. ENGINEER: no revenue, pipeline values or competitor names, even through the API
  perform pg_temp.raises('engineer', 'select count(*) from public.accounts', 'permission denied');
  perform pg_temp.raises('engineer', 'select ttm_billed_usd from public.accounts', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.opportunities', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.actions', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.whitespace_map', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.contacts', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.programmes', 'permission denied');
  perform pg_temp.raises('engineer', 'select count(*) from public.scorecard_weeks', 'permission denied');
  perform pg_temp.raises('engineer', 'select internal_statement from public.proof_points', 'permission denied');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.revenue_periods') = 0, 'engineer: revenue_periods returns 0 rows');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.competitors') = 0, 'engineer: competitors returns 0 rows');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.vendor_presence') = 0, 'engineer: vendor_presence returns 0 rows');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.share_of_wallet_readings') = 0, 'engineer: share readings 0 rows');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.accounts_safe') = 1, 'engineer sees only the account of their programme');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(ttm_billed_usd) + count(lifetime_billed_usd) + count(revenue_trend) + count(ext_eng_spend_usd) + count(share_of_wallet_pct) + count(strategic_notes) from public.accounts_safe') = 0, 'engineer: account money + strategy masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.opportunities_safe') = 0, 'engineer: no opportunities');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.whitespace_safe') = 0, 'engineer: no whitespace');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.actions_safe') = 1, 'engineer: own actions only');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(estimated_value_usd) from public.actions_safe') = 0, 'engineer: action value masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.touches') = 1, 'engineer: own touches only');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.contacts_safe') = 1, 'engineer: contacts of own programme only');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(rapport_notes) + count(email) + count(phone_mobile) + count(interests) from public.contacts_safe') = 0, 'engineer: rapport and contact details masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.programmes_safe') = 1, 'engineer: own programme visible');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(current_headcount) + count(monthly_run_rate_usd) from public.programmes_safe') = 0, 'engineer: programme money masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(known_budget_usd) from public.org_units_safe') = 0, 'engineer: org unit budget masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.org_units_safe') = 1, 'engineer: org units of own account only');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(internal_statement) from public.proof_points_safe') = 0, 'engineer: internal proof statement masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.proof_points_safe') = 1, 'engineer: approved proof point visible (external text)');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.scorecard_weeks_safe') = 1, 'engineer: published scorecard week visible, draft hidden');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(est_value_surfaced_usd) from public.scorecard_weeks_safe') = 0, 'engineer: scorecard value masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(value_usd) from public.success_stories_safe') = 0, 'engineer: story value masked');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.insights') = 1, 'engineer: own insights only');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.plays') = 1, 'engineer: approved plays only (draft hidden)');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.list_memberships') = 0 and pg_temp.n('engineer', 'select count(*) from public.testimonials') = 0, 'engineer: no lists/testimonials');
  perform pg_temp.raises('engineer', $$select public.log_conversation('{}'::jsonb)::text$$, 'NOT_ALLOWED');
  perform pg_temp.raises('engineer', $$select public.create_opportunity('{}'::jsonb)::text$$, 'NOT_ALLOWED');
  perform pg_temp.raises('engineer', 'insert into public.accounts (name) values (''x'')', 'permission denied');
  perform pg_temp.ok(pg_temp.n('engineer', $$with x as (update public.acsia_people set app_role = 'leader' returning 1) select count(*) from x$$) = 0, 'engineer cannot change roles (RLS blocks the update)');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.audit_log') = 0, 'engineer: audit log empty');
  perform pg_temp.raises('engineer', 'select auth_user_id from public.acsia_people', 'permission denied');

  -- every Internal-restricted column is unreachable for an engineer: no column privilege on the base table (or the table is wholly RLS-restricted),
  -- and every *_safe view returns NULL for it.
  for r in
    select c.relname as tbl, a.attname as col
    from pg_description d join pg_class c on c.oid = d.objoid join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
    where d.classoid = 'pg_class'::regclass and c.relnamespace = 'public'::regnamespace and d.objsubid > 0 and d.description like '%sensitivity=Internal-restricted%'
  loop
    if r.tbl = any(restricted_ok) then
      perform pg_temp.ok(pg_temp.n('engineer', format('select count(*) from public.%I', r.tbl)) = 0, format('restricted table %s returns 0 rows to engineer', r.tbl));
    elsif r.tbl = 'proof_points' then
      perform pg_temp.ok(not has_column_privilege('authenticated', format('public.%I', r.tbl)::regclass, r.col, 'SELECT'), format('%s.%s has no direct column grant', r.tbl, r.col));
      perform pg_temp.ok(pg_temp.n('engineer', format('select count(%I) from public.proof_points_safe', r.col)) = 0, 'proof_points_safe masks ' || r.col);
    else
      perform pg_temp.ok(not has_column_privilege('authenticated', format('public.%I', r.tbl)::regclass, r.col, 'SELECT'), format('%s.%s has no direct column grant', r.tbl, r.col));
      vw := case r.tbl when 'whitespace_map' then 'whitespace_safe' else r.tbl || '_safe' end;
      perform pg_temp.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = vw and column_name = r.col), format('%s exposes %s', vw, r.col));
      perform pg_temp.ok(pg_temp.n('engineer', format('select count(%I) from public.%I', r.col, vw)) = 0, format('%s.%s is NULL for engineer', vw, r.col));
      -- a delivery lead / PM / presales also may not read money columns
      if r.col not in ('internal_statement') then
        perform pg_temp.ok(pg_temp.n('pm', format('select count(%I) from public.%I', r.col, vw)) = 0, format('%s.%s is NULL for pm', vw, r.col));
        perform pg_temp.ok(pg_temp.n('lead', format('select count(%I) from public.%I', r.col, vw)) = 0, format('%s.%s is NULL for delivery lead', vw, r.col));
        perform pg_temp.ok(pg_temp.n('presales', format('select count(%I) from public.%I', r.col, vw)) = 0, format('%s.%s is NULL for presales', vw, r.col));
      end if;
    end if;
  end loop;

  ------------------------------------------------------------------ 4. PM: money masked, rapport visible, can log
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.accounts_safe') = 2, 'pm sees all accounts');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(strategic_notes) from public.accounts_safe') = 1, 'pm sees strategic notes');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(rapport_notes) from public.contacts_safe') = 2, 'pm sees rapport notes');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.competitors') = 0 and pg_temp.n('pm', 'select count(*) from public.revenue_periods') = 0, 'pm: competitors and revenue hidden');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.opportunities_safe') = 1 and pg_temp.n('pm', 'select count(estimated_value_usd) + count(competitor_ids) from public.opportunities_safe') = 0, 'pm: opportunity visible, value + competitor masked');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.insights') = 2, 'pm: sees non-money insights, not the rate-comparison one');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.touches') = 2, 'pm sees all touches');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.plays') = 1, 'pm: approved plays only');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(internal_statement) from public.proof_points_safe') = 1, 'pm can read internal proof statement');

  -- log: scheduled meeting with 3 asks -> 1 touch + 3 actions, no OG0.1
  j := pg_temp.exec_as('pm', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'contact_id', c1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams', 'note', 'Weekly sync'),
    'actions', jsonb_build_array(
      jsonb_build_object('action_code', 'OG1.1', 'service_line_id', slB, 'estimated_value_usd', 40000),
      jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA, 'estimated_value_usd', 80000, 'customer_answer', 'we need V&V help'),
      jsonb_build_object('action_code', 'OG2.2', 'service_line_id', slN, 'estimated_value_usd', 0)))))::jsonb;
  perform pg_temp.ok((j ->> 'actions_written')::int = 3, 'scheduled meeting with 3 asks writes 3 actions');
  perform pg_temp.ok((select count(*) from public.actions where touch_id = (j ->> 'touch_id')::uuid) = 3, 'db: 3 actions for that touch');
  perform pg_temp.ok(not exists (select 1 from public.actions where touch_id = (j ->> 'touch_id')::uuid and action_code = 'OG0.1'), 'scheduled meeting: no OG0.1');
  perform pg_temp.ok((select is_proactive from public.touches where touch_id = (j ->> 'touch_id')::uuid) = false, 'scheduled meeting is not proactive');
  perform pg_temp.ok((select count(*) from public.actions where touch_id = (j ->> 'touch_id')::uuid and person_id is not null and account_id = acc1 and action_date = public.today_ist()) = 3, 'actions denormalised from touch');

  -- proactive call with 2 asks -> OG0.1 + 2 = 3 actions; opportunity keeps source_action_id; follow-through rows
  j := pg_temp.exec_as('pm', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'contact_id', c1, 'touch_type', 'Proactive call', 'channel', 'Call', 'note', 'Called out of the blue', 'success_nominated', true),
    'actions', jsonb_build_array(
      jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA, 'estimated_value_usd', 120000, 'customer_answer', 'need test automation'),
      jsonb_build_object('action_code', 'OG4.1', 'service_line_id', slN, 'estimated_value_usd', 0)),
    'follow_through', jsonb_build_object(
      'insights', jsonb_build_array(jsonb_build_object('insight_type', 'Pain point', 'text', 'manual regression takes 3 weeks', 'ai_extracted', true)),
      'whitespace', jsonb_build_array(jsonb_build_object('service_line_id', slA, 'status', 'Need likely', 'from_action_index', 0, 'competitor_id', comp, 'est_annual_value_usd', 1)),
      'opportunities', jsonb_build_array(jsonb_build_object('name', 'Test automation', 'service_line_id', slA, 'estimated_value_usd', 120000, 'from_action_index', 0)),
      'referrals', jsonb_build_array(jsonb_build_object('from_action_index', 1, 'referred_name_text', 'Sue in the CV team')),
      'share_reading', jsonb_build_object('from_action_index', 0, 'stated_share_pct', 15, 'where_rest_goes', 'Rival')))))::jsonb;
  perform pg_temp.ok((j ->> 'actions_written')::int = 3, 'proactive call with 2 asks writes 3 actions (OG0.1 + 2)');
  perform pg_temp.ok((select count(*) from public.actions where touch_id = (j ->> 'touch_id')::uuid and action_code = 'OG0.1') = 1, 'OG0.1 added by code');
  perform pg_temp.ok((select o.source_action_id from public.opportunities o where o.name = 'Test automation') = ((j -> 'action_ids') ->> 0)::uuid, 'opportunity from a log stores source_action_id');
  perform pg_temp.ok((select o.origin || o.stage from public.opportunities o where o.name = 'Test automation') = 'Outgrow actionIdentified', 'opportunity origin Outgrow action, stage Identified');
  perform pg_temp.ok((select opportunity_created from public.actions where action_id = ((j -> 'action_ids') ->> 0)::uuid), 'action flagged opportunity_created');
  perform pg_temp.ok((j -> 'created' ->> 'insights')::int = 1 and (j -> 'created' ->> 'whitespace')::int = 1 and (j -> 'created' ->> 'referrals')::int = 1 and (j -> 'created' ->> 'share_readings')::int = 1 and (j -> 'created' ->> 'stories')::int = 1, 'follow-through created');
  perform pg_temp.ok((select competitor_id from public.whitespace_map where account_id = acc1 and service_line_id = slA) = comp, 'whitespace upsert kept the existing competitor (pm cannot set or clear it)');
  perform pg_temp.ok((select est_annual_value_usd from public.whitespace_map where account_id = acc1 and service_line_id = slA) = 300000, 'pm cannot overwrite the whitespace value');
  perform pg_temp.ok((select status from public.whitespace_map where account_id = acc1 and service_line_id = slA) = 'Need likely', 'whitespace status updated');
  perform pg_temp.ok((select referral_type from public.referrals where referred_name_text = 'Sue in the CV team') = 'Internal (same account group)', 'OG4.1 -> internal referral');
  perform pg_temp.ok((j -> 'week' ->> 'actions')::int >= 6, 'weekly count returned');
  perform pg_temp.ok((select last_proactive_touch_at from public.accounts where account_id = acc1) is not null, 'account last_proactive_touch_at set by trigger');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(estimated_value_usd) from public.actions_safe') = 0, 'pm: cannot read back any action value');
  perform pg_temp.ok(pg_temp.n('ae', 'select count(estimated_value_usd) from public.actions_safe') > 0, 'ae reads action values');

  -- rules
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG0.1', 'service_line_id', slN)))), 'OG01_CODE_ADDED');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.1', 'service_line_id', slN)))), 'DYK_NEEDS_SERVICE');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Email'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'chk_touches');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'), 'actions', '[]'::jsonb)), 'NO_ACTIONS');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams', 'touch_date', (public.today_ist() + 1)::text),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'BAD_DATE');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'contact_id', c2, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'BAD_CONTACT');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)),
    'follow_through', jsonb_build_object('referrals', jsonb_build_array(jsonb_build_object('from_action_index', 0, 'referred_name_text', 'x'))))), 'REFERRAL_NEEDS_CONTACT');
  -- atomic: a failure in follow-through leaves no touch behind
  select count(*) into cnt from public.touches;
  begin
    perform pg_temp.exec_as('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
      'touch', jsonb_build_object('account_id', acc1, 'contact_id', c1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
      'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)),
      'follow_through', jsonb_build_object('opportunities', jsonb_build_array(jsonb_build_object('name', 'x', 'service_line_id', slA, 'from_action_index', 5))))));
  exception when others then null; end;
  perform pg_temp.ok((select count(*) from public.touches) = cnt, 'failed save leaves no partial touch (atomic)');

  -- German contact: SMS -> avoid-list warning + opt-out warning for WhatsApp
  j := pg_temp.exec_as('pm', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc2, 'contact_id', c2, 'touch_type', 'Voicemail + text', 'channel', 'SMS'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))))::jsonb;
  perform pg_temp.ok(j -> 'warnings' @> '[{"code":"COUNTRY_AVOID"}]'::jsonb, 'SMS to a German contact returns the avoid-list warning');
  j := pg_temp.exec_as('pm', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc2, 'contact_id', c2, 'touch_type', 'Proactive call', 'channel', 'WhatsApp'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))))::jsonb;
  perform pg_temp.ok(j -> 'warnings' @> '[{"code":"OPT_OUT"}]'::jsonb, 'opted-out channel returns an opt-out warning');

  -- opportunities: PM may create Identified only, may not change stage
  perform pg_temp.raises('pm', format($$select public.create_opportunity(%L::jsonb)::text$$, jsonb_build_object('name', 'n', 'account_id', acc1, 'service_line_id', slA, 'stage', 'Proposal sent')), 'only create Identified');
  perform pg_temp.raises('pm', format($$select public.set_opportunity_stage(%L, 'Won')$$, opp1), 'NOT_ALLOWED');
  perform pg_temp.raises('pm', format($$select public.create_opportunity(%L::jsonb)::text$$, jsonb_build_object('name', 'n', 'account_id', acc1, 'service_line_id', slA, 'origin', 'Outgrow action')), 'SOURCE_REQUIRED');
  perform pg_temp.ok(pg_temp.exec_as('pm', format($$select public.create_opportunity(%L::jsonb)::text$$, jsonb_build_object('name', 'PM opp', 'account_id', acc1, 'service_line_id', slA))) is not null, 'pm can create an Identified opportunity');
  perform pg_temp.ok(pg_temp.n('pm', $$with x as (update public.acsia_people set weekly_target = 99 returning 1) select count(*) from x$$) = 0, 'pm cannot change targets (RLS blocks the update)');
  perform pg_temp.raises('pm', 'insert into public.touches (account_id, person_id, logged_by_id, touch_type, channel) values (null, null, null, ''x'', ''y'')', 'permission denied');

  ------------------------------------------------------------------ 5. AE / SDR / presales
  perform pg_temp.ok(pg_temp.n('ae', 'select count(ttm_billed_usd) from public.accounts_safe') = 2, 'ae sees account revenue');
  perform pg_temp.ok(pg_temp.n('ae', 'select count(*) from public.competitors') = 1 and pg_temp.n('ae', 'select count(*) from public.revenue_periods') = 1, 'ae sees competitors and revenue');
  perform pg_temp.ok(pg_temp.n('ae', 'select count(competitor_ids) from public.opportunities_safe') >= 1, 'ae sees opportunity competitors');
  perform pg_temp.ok(pg_temp.n('ae', 'select count(*) from public.insights') = pg_temp.n('pm', 'select count(*) from public.insights') + 1, 'ae sees the rate-comparison insight that pm cannot');
  perform pg_temp.ok(pg_temp.n('sdr', 'select count(ttm_billed_usd) from public.accounts_safe') = 2, 'sdr can see money');
  perform pg_temp.ok(pg_temp.n('presales', 'select count(ttm_billed_usd) from public.accounts_safe') = 0, 'presales cannot see money');
  perform pg_temp.ok(pg_temp.n('presales', 'select count(rapport_notes) from public.contacts_safe') = 0, 'presales cannot see rapport notes');
  perform pg_temp.ok(pg_temp.n('presales', 'select count(*) from public.competitors') = 0, 'presales cannot see competitors');
  perform pg_temp.exec_as('ae', format($$select public.set_opportunity_stage(%L, 'Negotiation')::text$$, opp1));
  perform pg_temp.ok((select stage from public.opportunities where opportunity_id = opp1) = 'Negotiation', 'stage changed');
  perform pg_temp.raises('sdr', format($$select public.set_opportunity_stage(%L, 'Won')$$, opp1), 'NOT_ALLOWED');
  perform pg_temp.raises('ae', format($$select public.set_opportunity_stage(%L, 'Lost')$$, opp1), 'REASON_REQUIRED');
  perform pg_temp.ok(exists (select 1 from public.audit_log where table_name = 'opportunities' and field = 'stage' and new_value = 'Negotiation'), 'audit trail records the stage change');

  ------------------------------------------------------------------ 6. delivery lead: proxy logging, team assignments, inbox
  perform pg_temp.ok(pg_temp.exec_as('engineer', $$select public.submit_capture('Customer mentioned they are struggling with HIL test benches')::text$$) is not null, 'engineer can send a note');
  perform pg_temp.ok(pg_temp.n('lead', 'select count(*) from public.capture_inbox') = 1, 'lead sees their engineer''s note');
  perform pg_temp.ok(pg_temp.n('other_lead', 'select count(*) from public.capture_inbox') = 0, 'another lead does not');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.capture_inbox') = 0, 'pm does not see the inbox');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.capture_inbox') = 1, 'engineer sees own note status');
  perform pg_temp.ok(pg_temp.n('lead', 'select count(*) from public.notifications') = 1, 'lead was notified of the note');
  j := pg_temp.exec_as('lead', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'contact_id', c1, 'person_id', pg_temp.id('eng'), 'touch_type', 'Scheduled meeting', 'channel', 'Teams', 'capture_method', 'Text to manager (AI-parsed)'),
    'inbox_id', (select id from public.capture_inbox limit 1),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA, 'estimated_value_usd', 10)))))::jsonb;
  perform pg_temp.ok((select person_id = pg_temp.id('eng') and logged_by_id = pg_temp.id('lead') from public.touches where touch_id = (j ->> 'touch_id')::uuid), 'proxy log credits the engineer, records the manager as logger');
  perform pg_temp.ok((select status from public.capture_inbox limit 1) = 'logged', 'inbox item marked logged');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.actions_safe') = 2, 'engineer sees the action logged for them');
  perform pg_temp.raises('lead', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'person_id', pg_temp.id('eng2'), 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'only log for your own reports');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'person_id', pg_temp.id('eng'), 'touch_type', 'Scheduled meeting', 'channel', 'Teams'),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'only log for your own reports');

  perform pg_temp.ok(pg_temp.exec_as('lead', format($$select public.create_assignment(%L::jsonb)::text$$, jsonb_build_object(
    'assignee_id', pg_temp.id('pm'), 'contact_id', c1, 'instruction', 'Ask Dana what else she is working on', 'suggested_play_id', 'DYK-T1'))) is not null, 'lead can assign a team member');
  perform pg_temp.raises('lead', format($$select public.create_assignment(%L::jsonb)::text$$, jsonb_build_object('assignee_id', pg_temp.id('ae'), 'contact_id', c1, 'instruction', 'x')), 'only assign your own team');
  perform pg_temp.raises('pm', format($$select public.create_assignment(%L::jsonb)::text$$, jsonb_build_object('assignee_id', pg_temp.id('pm'), 'contact_id', c1, 'instruction', 'x')), 'only assign your own team');
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.assignments') = 1, 'assignee sees own assignment');
  perform pg_temp.ok(pg_temp.n('ae', 'select count(*) from public.assignments') = 0, 'unrelated ae does not');
  perform pg_temp.ok(pg_temp.n('lead', 'select count(*) from public.assignments') = 1 and pg_temp.n('leader', 'select count(*) from public.assignments') = 1 and pg_temp.n('ceo', 'select count(*) from public.assignments') = 1, 'lead, leader, ceo see team assignment');
  perform pg_temp.ok(pg_temp.n('other_lead', 'select count(*) from public.assignments') = 0, 'another lead does not');
  select assignment_id into assign1 from public.assignments limit 1;
  perform pg_temp.raises('pm', format($$select public.set_assignment_status(%L, 'Skipped')$$, assign1), 'REASON_REQUIRED');
  j := pg_temp.exec_as('pm', format($j$select public.log_conversation(%L::jsonb)::text$j$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'contact_id', c1, 'touch_type', 'Unscheduled visit (on site)', 'channel', 'In person', 'assignment_id', assign1),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))))::jsonb;
  perform pg_temp.ok((select status from public.assignments where assignment_id = assign1) = 'Done', 'logging marks the assignment Done');
  perform pg_temp.raises('pm', format($$select public.log_conversation(%L::jsonb)::text$$, jsonb_build_object(
    'touch', jsonb_build_object('account_id', acc1, 'touch_type', 'Scheduled meeting', 'channel', 'Teams', 'assignment_id', assign1),
    'actions', jsonb_build_array(jsonb_build_object('action_code', 'OG1.2', 'service_line_id', slA)))), 'ASSIGNMENT_MISMATCH');
  perform pg_temp.raises('lead', format($$select public.create_assignment(%L::jsonb)::text$$, jsonb_build_object('assignee_id', pg_temp.id('pm'), 'contact_id', c1, 'instruction', 'x again')), 'duplicate key');

  ------------------------------------------------------------------ 7. leader, CEO, scorecard
  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.scorecard_weeks_safe') = 2, 'leader sees draft + published weeks');
  perform pg_temp.ok(pg_temp.n('ceo', 'select count(est_value_surfaced_usd) from public.scorecard_weeks_safe') = 2, 'ceo sees scorecard value');
  perform pg_temp.raises('ceo', $$select public.log_conversation('{}'::jsonb)::text$$, 'NOT_ALLOWED');
  perform pg_temp.ok(pg_temp.n('ceo', 'select count(*) from public.touches') >= 5, 'ceo reads all touches');
  perform pg_temp.raises('pm', $$select public.publish_scorecard(public.today_ist(), 'Great work Priya and Arjun')::text$$, 'NOT_ALLOWED');
  perform pg_temp.raises('leader', $$select public.publish_scorecard(public.today_ist(), '')::text$$, 'COMMENTARY_REQUIRED');
  perform pg_temp.raises('leader', $$select public.publish_scorecard(public.today_ist(), 'Great work by Priya this week.')::text$$, 'NAMES_REQUIRED');
  perform pg_temp.raises('leader', $$select public.publish_scorecard(public.today_ist(), 'Great week from the CEO and the Leader.')::text$$, 'NAMES_REQUIRED');
  perform pg_temp.ok(public.people_named_in('Thanks Priya and arjun; also Ravi') @> array[pg_temp.id('pm'), pg_temp.id('ae')], 'names are detected case-insensitively on first names');
  perform pg_temp.ok(pg_temp.n('leader', 'select (public.week_summary(public.today_ist()) ->> ''participants'')::int') >= 0, 'week_summary works for leader');
  perform pg_temp.raises('pm', $$select public.week_summary(public.today_ist())::text$$, 'NOT_ALLOWED');
  j := pg_temp.exec_as('ceo', $$select public.publish_scorecard(public.today_ist(), 'Big week: Priya opened three conversations and Arjun followed every proposal.')::text$$)::jsonb;
  perform pg_temp.ok(jsonb_array_length(j -> 'named_person_ids') = 2, 'ceo can publish once two roster people are named');
  perform pg_temp.ok((select status from public.scorecard_weeks where week_start = public.week_start_of(public.today_ist())) = 'Published', 'week is Published');
  perform pg_temp.ok((select participation_rate from public.scorecard_weeks where week_start = public.week_start_of(public.today_ist())) is not null, 'participation computed over whole roster');
  perform pg_temp.ok((select count(*) from public.person_week_stats s join public.scorecard_weeks w using (week_id) where w.week_start = public.week_start_of(public.today_ist())) = (select count(*) from public.acsia_people where is_participant and weekly_target > 0 and active), 'person_week_stats freezes the WHOLE roster incl. zero loggers');
  perform pg_temp.raises('leader', $$select public.publish_scorecard(public.today_ist(), 'Priya and Arjun again')::text$$, 'ALREADY_PUBLISHED');
  perform pg_temp.ok(pg_temp.n('engineer', 'select count(*) from public.scorecard_weeks_safe') = 2, 'engineer now sees the newly published week');
  perform pg_temp.ok(pg_temp.n('engineer', format('select count(*) from public.person_week_stats where person_id = %L', pg_temp.id('eng'))) = 1, 'engineer sees own frozen stats');
  perform pg_temp.ok(pg_temp.n('pm', format('select count(*) from public.person_week_stats where person_id = %L', pg_temp.id('eng'))) = 0, 'unranked engineer is not exposed to others on the scorecard');
  perform pg_temp.ok(pg_temp.n('pm', format('select count(*) from public.person_week_stats where person_id = %L', pg_temp.id('ae'))) = 1, 'ranked person visible to colleagues after publish');
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scorecard_weeks' and column_name ilike '%closed%'), 'no closed-revenue column on the scorecard');


  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.ai_routes') = 1 and pg_temp.n('pm', 'select count(*) from public.ai_routes') = 0, 'ai_routes: leader reads, pm does not');
  perform pg_temp.ok(pg_temp.n('leader', $$with x as (update public.ai_routes set primary_model = 'a/b' returning 1) select count(*) from x$$) = 1 and pg_temp.n('pm', $$with x as (update public.ai_routes set enabled = false returning 1) select count(*) from x$$) = 0, 'ai_routes: only leader updates');

  ------------------------------------------------------------------ 8. admin
  perform pg_temp.ok(pg_temp.exec_as('admin', 'select (public.get_me() ->> ''is_admin'')') = 'true', 'admin get_me works without a roster row');
  perform pg_temp.ok(pg_temp.n('admin', 'select count(ttm_billed_usd) from public.accounts_safe') = 2, 'admin sees everything');
  perform pg_temp.ok(pg_temp.n('admin', 'select count(*) from public.audit_log') > 0, 'admin can read the audit log');
  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.audit_log') = 0, 'leader cannot read the audit log');
  perform pg_temp.ok(pg_temp.n('leader', $$with x as (update public.app_settings set value = 'x' returning 1) select count(*) from x$$) = 0, 'leader cannot change settings');
  perform pg_temp.ok(pg_temp.n('leader', 'select count(*) from public.app_settings') = 4, 'leader only sees the non-sensitive settings');
  perform pg_temp.ok(pg_temp.n('admin', 'select count(*) from public.app_settings') >= 7, 'admin sees all settings');
  perform pg_temp.ok(pg_temp.n('admin', 'select count(*) from public.acsia_people') = 10, 'admin sees the roster');
  perform pg_temp.ok(pg_temp.n('admin', $$with x as (insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target) values ('New Hire', 'new@test.local', 'SDR', 'Frontline', 'sdr', 10) returning 1) select count(*) from x$$) = 1, 'admin can add an employee');
  perform pg_temp.raises('leader', $$insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target) values ('Sneaky', 'sneaky@test.local', 'SDR', 'Frontline', 'sdr', 10)$$, 'row-level security');
  perform pg_temp.ok(pg_temp.n('leader', $$select count(*) from public.acsia_people$$) >= 10, 'everyone on the roster can read names');
  perform pg_temp.ok(exists (select 1 from public.audit_log where table_name = 'acsia_people' and field = 'email' and new_value = 'new@test.local'), 'roster change audited');
  update public.acsia_people set active = false where email = 'pm@test.local';
  perform pg_temp.ok(pg_temp.n('pm', 'select count(*) from public.accounts_safe') = 0, 'deactivated employee loses all access immediately');
  update public.acsia_people set active = true where email = 'pm@test.local';

  -- link trigger: roster row added after the auth user exists gets linked by email
  insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'late@test.local');
  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target) values ('Late Joiner', 'late@test.local', 'SDR', 'Frontline', 'sdr', 10);
  perform pg_temp.ok((select auth_user_id from public.acsia_people where email = 'late@test.local') = '11111111-1111-1111-1111-111111111111', 'roster row links to an existing auth user by email');
  insert into public.acsia_people (full_name, email, job_role, outgrow_role, app_role, weekly_target) values ('Early Bird', 'early@test.local', 'SDR', 'Frontline', 'sdr', 10);
  insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'early@test.local');
  perform pg_temp.ok((select auth_user_id from public.acsia_people where email = 'early@test.local') = '22222222-2222-2222-2222-222222222222', 'auth user creation links to the pre-added roster row');

  -- remove examples: flags + dependents, leaves real data
  update public.accounts set is_example = true where account_id = acc2;
  update public.contacts set is_example = true where contact_id = c2;
  perform pg_temp.raises('leader', 'select public.remove_examples()::text', 'only the admin');
  j := pg_temp.exec_as('admin', 'select public.remove_examples()::text')::jsonb;
  perform pg_temp.ok(not exists (select 1 from public.accounts where account_id = acc2) and not exists (select 1 from public.contacts where contact_id = c2), 'examples removed');
  perform pg_temp.ok(not exists (select 1 from public.touches where account_id = acc2), 'touches logged against an example account are removed with it');
  perform pg_temp.ok(exists (select 1 from public.accounts where account_id = acc1), 'real data untouched');

  raise exception 'RLS_TESTS_PASSED % assertions', current_setting('t.passed');
end
$test$;
