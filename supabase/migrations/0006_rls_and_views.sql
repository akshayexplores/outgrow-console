-- Row Level Security on every table + owner-run, security_barrier *_safe views that mask restricted columns.
-- Model (docs/03): default-deny; roles read from the DB; tables with any Internal-restricted column have NO direct SELECT for
-- authenticated users - the app reads the *_safe view. Writes to business tables go through SECURITY DEFINER RPCs (0007).

------------------------------------------------------------------ 0. reset privileges, enable RLS everywhere
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;

do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

------------------------------------------------------------------ 1. reference / library tables
-- everyone on the roster reads; leader (or admin) writes.
do $$
declare t text;
begin
  foreach t in array array['service_lines','capabilities','focus_calendar','channel_rules','list_definitions'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_employee()))', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_leader())) with check ((select public.is_leader()))', t || '_write', t);
  end loop;
end $$;

grant select on public.picklists to authenticated;
grant insert, update, delete on public.picklists to authenticated;
create policy picklists_read on public.picklists for select to authenticated using ((select public.is_employee()));
create policy picklists_write on public.picklists for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- plays: only approved plays reach the field; leader sees drafts.
grant select on public.plays to authenticated;
grant insert, update, delete on public.plays to authenticated;
create policy plays_read on public.plays for select to authenticated
  using ((select public.is_employee()) and (approval_status like 'Approved%' or (select public.is_leader())));
create policy plays_write on public.plays for all to authenticated using ((select public.is_leader())) with check ((select public.is_leader()));

-- testimonials / interviews: personal data + customer voice; not for engineers.
do $$
declare t text;
begin
  foreach t in array array['testimonials','happy_customer_interviews'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_employee()) and not (select public.is_engineer()))', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_leader())) with check ((select public.is_leader()))', t || '_write', t);
  end loop;
end $$;

-- proof points: internal_statement (may name customers) is not selectable on the base table at all.
grant select (proof_id, title, external_statement, programme_id, end_customer_account_id, service_line_ids, approval_status, review_due, created_at, updated_at, is_example)
  on public.proof_points to authenticated;
grant insert, update, delete on public.proof_points to authenticated;
create policy proof_points_read on public.proof_points for select to authenticated
  using ((select public.is_employee()) and (approval_status like 'Approved%' or (select public.is_leader())));
create policy proof_points_write on public.proof_points for all to authenticated using ((select public.is_leader())) with check ((select public.is_leader()));

------------------------------------------------------------------ 2. roster and settings
-- Roster: everyone reads names/roles/targets (not the auth link); only the admin writes.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'acsia_people' and column_name <> 'auth_user_id';
  execute format('grant select (%s) on public.acsia_people to authenticated', cols);
end $$;
grant insert, update, delete on public.acsia_people to authenticated;
create policy people_read on public.acsia_people for select to authenticated using ((select public.is_employee()));
create policy people_admin on public.acsia_people for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.app_settings to authenticated;
create policy settings_read on public.app_settings for select to authenticated
  using ((select public.is_admin()) or key in ('timezone','week_start','scorecard_publish_time','examples_loaded'));
create policy settings_admin on public.app_settings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using ((select public.is_admin()));

------------------------------------------------------------------ 3. AI operator + cron bookkeeping
grant select on public.ai_routes to authenticated;
grant update (primary_model, fallback_model, temperature, max_tokens, enabled) on public.ai_routes to authenticated;
create policy routes_read on public.ai_routes for select to authenticated using ((select public.is_leader()));
create policy routes_update on public.ai_routes for update to authenticated using ((select public.is_leader())) with check ((select public.is_leader()));

grant select on public.ai_runs to authenticated;
create policy runs_read on public.ai_runs for select to authenticated using ((select public.is_leader()) or person_id = (select public.current_person_id()));
grant select on public.job_runs to authenticated;
create policy job_runs_read on public.job_runs for select to authenticated using ((select public.is_leader()));

------------------------------------------------------------------ 4. people-facing motion tables (read via RLS, write via RPC)
grant select on public.touches to authenticated;
create policy touches_read on public.touches for select to authenticated using (
  (select public.is_exec()) or ((select public.is_employee()) and (not (select public.is_engineer())
    or person_id = (select public.current_person_id()) or logged_by_id = (select public.current_person_id()))));

grant select on public.insights to authenticated;
create policy insights_read on public.insights for select to authenticated using (
  (select public.is_employee())
  and (not (select public.is_engineer()) or captured_by_id = (select public.current_person_id()))
  and (insight_type not in ('Budget','Gives to other vendor','Rate comparison') or (select public.can_see_money())));

grant select on public.list_memberships to authenticated;
create policy list_memberships_read on public.list_memberships for select to authenticated using ((select public.is_employee()) and not (select public.is_engineer()));
grant select on public.referrals to authenticated;
create policy referrals_read on public.referrals for select to authenticated using ((select public.is_employee()) and not (select public.is_engineer()));
grant select on public.contact_positions to authenticated;
create policy contact_positions_read on public.contact_positions for select to authenticated using ((select public.is_employee()) and not (select public.is_engineer()));

grant select on public.relationships to authenticated;
create policy relationships_read on public.relationships for select to authenticated using (
  (select public.is_employee()) and (not (select public.is_engineer()) or person_id = (select public.current_person_id())));

grant select on public.assignments to authenticated;
create policy assignments_read on public.assignments for select to authenticated using (
  (select public.is_exec())
  or assignee_id = (select public.current_person_id())
  or assigned_by_id = (select public.current_person_id())
  or ((select public.is_manager()) and assignee_id = any((select public.my_team_ids())::uuid[])));

grant select on public.capture_inbox to authenticated;
create policy inbox_read on public.capture_inbox for select to authenticated using (
  from_person_id = (select public.current_person_id())
  or to_manager_id = (select public.current_person_id())
  or (select public.is_leader())
  or ((select public.is_manager()) and from_person_id = any((select public.my_team_ids())::uuid[])));

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (person_id = (select public.current_person_id()));
create policy notifications_update on public.notifications for update to authenticated
  using (person_id = (select public.current_person_id())) with check (person_id = (select public.current_person_id()));

grant select on public.person_week_stats to authenticated;
create policy pws_read on public.person_week_stats for select to authenticated using (
  (select public.is_exec())
  or person_id = (select public.current_person_id())
  or ((select public.is_employee())
      and public.week_is_published(person_week_stats.week_id)
      and exists (select 1 from public.acsia_people p where p.person_id = person_week_stats.person_id and p.show_on_ranked_scorecard)));

grant select on public.perseverance_board to authenticated;
create policy persev_read on public.perseverance_board for select to authenticated using ((select public.is_exec()) or owner_id = (select public.current_person_id()));
grant select on public.meetings to authenticated;
create policy meetings_read on public.meetings for select to authenticated using (
  (select public.is_exec()) or facilitator_id = (select public.current_person_id()) or participant_id = (select public.current_person_id())
  or (select public.current_person_id()) = any(attendee_ids));

-- programme children: engineers only see the programmes they sit on.
do $$
declare t text;
begin
  foreach t in array array['programme_services','programme_team','programme_contacts','milestones'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated using ((select public.is_employee()) and (not (select public.is_engineer()) or programme_id = any((select public.my_programme_ids())::uuid[])))$p$, t || '_read', t);
  end loop;
end $$;

------------------------------------------------------------------ 5. wholly restricted tables (money / competitor intel): plain RLS
do $$
declare t text;
begin
  foreach t in array array['revenue_periods','vendor_presence','competitors','share_of_wallet_readings'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_see_money()))', t || '_read', t);
  end loop;
end $$;

------------------------------------------------------------------ 6. mixed tables: NO direct grants. Reads via *_safe views (owner-run: they bypass RLS, so each carries its own row filter).
-- accounts, org_units, contacts, programmes, opportunities, actions, whitespace_map, scorecard_weeks, success_stories

create view public.accounts_safe with (security_barrier = true) as
select a.account_id, a.name, a.legal_name, a.parent_account_id, a.account_level, a.relationship_type, a.track, a.segment, a.vehicle_domain,
       a.region, a.country, a.city_site, a.web_domain, a.tier, a.tier_override, a.customer_status, a.account_owner_id, a.outgrow_owner_id, a.first_won_date,
       case when (select public.can_see_money()) then a.lifetime_billed_usd end as lifetime_billed_usd,
       case when (select public.can_see_money()) then a.ttm_billed_usd end as ttm_billed_usd,
       case when (select public.can_see_money()) then a.revenue_trend end as revenue_trend,
       case when (select public.can_see_money()) then a.ext_eng_spend_usd end as ext_eng_spend_usd,
       case when (select public.can_see_money()) then a.ext_eng_spend_source end as ext_eng_spend_source,
       case when (select public.can_see_money()) then a.share_of_wallet_pct end as share_of_wallet_pct,
       a.service_lines_bought, a.buying_committee_est, a.contacts_mapped, a.coverage_ratio, a.power_map_status, a.vendor_panel_status,
       a.contract_status, a.contract_expiry, a.last_proactive_touch_at,
       case when a.last_proactive_touch_at is null then null else public.today_ist() - (a.last_proactive_touch_at at time zone 'Asia/Kolkata')::date end as days_since_proactive_touch,
       a.last_any_interaction_at, a.next_planned_touch, a.lead_play_ids,
       case when (select public.can_see_rapport()) then a.strategic_notes end as strategic_notes,
       a.is_example, a.updated_at
from public.accounts a
where a.archived_at is null and (select public.is_employee())
  and (not (select public.is_engineer()) or a.account_id = any(((select public.my_account_ids()))::uuid[]));

create view public.org_units_safe with (security_barrier = true) as
select o.org_unit_id, o.account_id, o.parent_org_unit_id, o.name, o.function, o.vehicle_domain, o.site_location, o.head_contact_id, o.acsia_presence,
       case when (select public.can_see_money()) then o.known_budget_usd end as known_budget_usd,
       case when not (select public.is_engineer()) then o.next_sourcing_event end as next_sourcing_event,
       case when not (select public.is_engineer()) then o.sourcing_notes end as sourcing_notes,
       o.discovered_via, o.is_example
from public.org_units o
where o.archived_at is null and (select public.is_employee())
  and (not (select public.is_engineer()) or o.account_id = any(((select public.my_account_ids()))::uuid[]));

create view public.contacts_safe with (security_barrier = true) as
select c.contact_id, c.first_name, c.last_name, c.preferred_name, c.job_title, c.account_id, c.org_unit_id, c.reports_to_contact_id, c.seniority,
       c.function, c.buying_role, c.influence_level, c.decision_authority,
       case when not (select public.is_engineer()) then c.email end as email,
       case when not (select public.is_engineer()) then c.phone_office end as phone_office,
       case when not (select public.is_engineer()) then c.phone_mobile end as phone_mobile,
       case when not (select public.is_engineer()) then c.messaging_handle end as messaging_handle,
       case when not (select public.is_engineer()) then c.linkedin_url end as linkedin_url,
       c.country, c.timezone, c.language_pref, c.preferred_channel, c.opt_out_channels,
       case when not (select public.is_engineer()) then c.legal_basis end as legal_basis,
       c.contact_status, c.moved_to_contact_id, c.primary_relationship_owner_id, c.relationship_strength, c.sentiment, c.happy_customer_candidate,
       c.interview_status, c.testimonial_permission,
       case when (select public.can_see_rapport()) then c.interests end as interests,
       case when (select public.can_see_rapport()) then c.rapport_notes end as rapport_notes,
       case when (select public.can_see_rapport()) then c.current_priorities end as current_priorities,
       c.service_lines_dyked, c.next_recommended_play_id, c.touch_cadence_days, c.last_proactive_touch_at,
       case when c.last_proactive_touch_at is null then null else public.today_ist() - (c.last_proactive_touch_at at time zone 'Asia/Kolkata')::date end as days_since_proactive_touch,
       c.next_touch_due, c.single_thread_risk, c.referred_by_contact_id, c.source, c.is_example
from public.contacts c
where c.archived_at is null and (select public.is_employee())
  and (not (select public.is_engineer()) or c.account_id = any(((select public.my_account_ids()))::uuid[]));

create view public.programmes_safe with (security_barrier = true) as
select p.programme_id, p.name, p.internal_code, p.contracting_account_id, p.end_customer_account_id, p.org_unit_id, p.vehicle_programme, p.status,
       p.start_date, p.planned_end_date, p.renewal_date, p.engagement_model, p.sites,
       case when (select public.can_see_money()) then p.current_headcount end as current_headcount,
       case when (select public.can_see_money()) then p.monthly_run_rate_usd end as monthly_run_rate_usd,
       p.delivery_lead_id, p.customer_lead_contact_id, p.aspice_processes, p.health, p.health_note, p.testimonial_eligible, p.next_milestone_date, p.is_example
from public.programmes p
where p.archived_at is null and (select public.is_employee())
  and (not (select public.is_engineer()) or p.programme_id = any(((select public.my_programme_ids()))::uuid[]));

create view public.opportunities_safe with (security_barrier = true) as
select o.opportunity_id, o.name, o.account_id, o.org_unit_id, o.primary_contact_id, o.related_programme_id, o.end_customer_account_id, o.service_line_id,
       o.capability_ids, o.expansion_lever, o.origin, o.source_action_id, o.surfaced_by_id, o.owner_id, o.stage, o.stage_changed_at,
       public.today_ist() - (o.stage_changed_at at time zone 'Asia/Kolkata')::date as days_in_stage,
       case when (select public.can_see_money()) then o.estimated_value_usd end as estimated_value_usd,
       o.value_basis, o.is_mega_rfq, o.proposal_sent_date,
       case when o.proposal_sent_date is null then null else public.today_ist() - o.proposal_sent_date end as proposal_age_days,
       o.next_step, o.next_step_date, o.decision_expected,
       case when (select public.can_see_money()) then o.competitor_ids end as competitor_ids,
       o.closed_date, o.lost_reason, o.won_programme_id, o.created_at, o.is_example
from public.opportunities o
where o.archived_at is null and (select public.is_employee()) and not (select public.is_engineer());

create view public.actions_safe with (security_barrier = true) as
select a.action_id, a.touch_id, a.action_code, a.service_line_id,
       case when (select public.can_see_money()) then a.estimated_value_usd end as estimated_value_usd,
       a.value_stage, a.play_id, a.customer_answer, a.testimonial_id, a.opportunity_id, a.opportunity_created, a.referral_id, a.share_reading_id,
       a.person_id, a.account_id, a.action_date, a.created_at, a.is_example
from public.actions a
where a.archived_at is null and (select public.is_employee())
  and ((select public.is_exec()) or not (select public.is_engineer()) or a.person_id = (select public.current_person_id()));

create view public.whitespace_safe with (security_barrier = true) as
select w.whitespace_id, w.account_id, w.org_unit_id, w.service_line_id, w.status, w.status_source, w.evidence_action_id, w.evidence_insight_id,
       case when (select public.can_see_money()) then w.competitor_id end as competitor_id,
       case when (select public.can_see_money()) then w.est_annual_value_usd end as est_annual_value_usd,
       w.acsia_approved_category, w.priority, w.recommended_play_id, w.last_verified_at, w.is_example
from public.whitespace_map w
where w.archived_at is null and (select public.is_employee()) and not (select public.is_engineer());

create view public.scorecard_weeks_safe with (security_barrier = true) as
select s.week_id, s.week_start, s.status, s.ceo_commentary, s.named_person_ids, s.total_actions, s.participation_rate, s.proposals_raised, s.opps_created,
       s.followups_made,
       case when (select public.can_see_money()) then s.est_value_surfaced_usd end as est_value_surfaced_usd,
       s.featured_story_ids, s.featured_testimonial_id, s.published_at, s.is_example
from public.scorecard_weeks s
where s.archived_at is null and (select public.is_employee()) and (s.status = 'Published' or (select public.is_exec()));

create view public.success_stories_safe with (security_barrier = true) as
select s.story_id, s.touch_id, s.person_id, s.account_id, s.service_line_id, s.story_text,
       case when (select public.can_see_money()) then s.value_usd end as value_usd,
       s.status, s.featured_week_id, s.created_at, s.is_example
from public.success_stories s
where s.archived_at is null and (select public.is_employee())
  and (not (select public.is_engineer()) or s.person_id = (select public.current_person_id()) or s.status = 'Featured');

create view public.proof_points_safe with (security_barrier = true) as
select p.proof_id, p.title,
       case when not (select public.is_engineer()) then p.internal_statement end as internal_statement,
       p.external_statement, p.programme_id, p.end_customer_account_id, p.service_line_ids, p.approval_status, p.review_due, p.is_example
from public.proof_points p
where p.archived_at is null and (select public.is_employee()) and (p.approval_status like 'Approved%' or (select public.is_leader()));

grant select on public.accounts_safe, public.org_units_safe, public.contacts_safe, public.programmes_safe, public.opportunities_safe,
  public.actions_safe, public.whitespace_safe, public.scorecard_weeks_safe, public.success_stories_safe, public.proof_points_safe to authenticated;
