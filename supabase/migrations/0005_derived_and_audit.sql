-- Derived fields (triggers), row stamping, updated_at, and the restricted-field audit trail.

------------------------------------------------------------------ stamping
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Tables from the data model carry created_by/updated_by (roster person id).
create or replace function public.stamp_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object('created_by', coalesce((to_jsonb(new)->>'created_by')::uuid, public.current_person_id())));
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('updated_by', coalesce(public.current_person_id(), (to_jsonb(new)->>'updated_by')::uuid)));
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select c.table_name,
           exists (select 1 from information_schema.columns c2 where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'created_by') as has_created_by
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    if r.has_created_by then
      execute format('create trigger trg_stamp before insert or update on public.%I for each row execute function public.stamp_row()', r.table_name);
    else
      execute format('create trigger trg_updated_at before update on public.%I for each row execute function public.set_updated_at()', r.table_name);
    end if;
  end loop;
end $$;

------------------------------------------------------------------ touches / actions denormalisation
create or replace function public.trg_touches_bi() returns trigger language plpgsql as $$
begin
  new.is_proactive := public.touch_type_is_proactive(new.touch_type);
  return new;
end $$;
create trigger trg_touches_bi before insert or update of touch_type on public.touches
  for each row execute function public.trg_touches_bi();

create or replace function public.trg_touches_ai() returns trigger language plpgsql security definer set search_path = '' as $$
declare ts timestamptz := ((new.touch_date::timestamp + time '12:00') at time zone 'Asia/Kolkata');
begin
  update public.accounts a set
    last_any_interaction_at = greatest(coalesce(a.last_any_interaction_at, '-infinity'), ts),
    last_proactive_touch_at = case when new.is_proactive then greatest(coalesce(a.last_proactive_touch_at, '-infinity'), ts) else a.last_proactive_touch_at end
  where a.account_id = new.account_id;
  if new.contact_id is not null then
    update public.contacts c set
      last_proactive_touch_at = case when new.is_proactive then greatest(coalesce(c.last_proactive_touch_at, '-infinity'), ts) else c.last_proactive_touch_at end
    where c.contact_id = new.contact_id;
    update public.relationships r set last_interaction_at = greatest(coalesce(r.last_interaction_at, '-infinity'), ts)
    where r.person_id = new.person_id and r.contact_id = new.contact_id;
  end if;
  return new;
end $$;
create trigger trg_touches_ai after insert on public.touches
  for each row execute function public.trg_touches_ai();

create or replace function public.trg_actions_bi() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select t.person_id, t.account_id, t.touch_date into new.person_id, new.account_id, new.action_date
  from public.touches t where t.touch_id = new.touch_id;
  return new;
end $$;
create trigger trg_actions_bi before insert on public.actions
  for each row execute function public.trg_actions_bi();

-- Opportunity stage bookkeeping + measurement integrity
create or replace function public.trg_opps_bu() returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage in ('Won','Lost') and new.closed_date is null then new.closed_date := public.today_ist(); end if;
    if new.stage = 'Proposal sent' and new.proposal_sent_date is null then new.proposal_sent_date := public.today_ist(); end if;
  end if;
  return new;
end $$;
create trigger trg_opps_bu before update on public.opportunities
  for each row execute function public.trg_opps_bu();

-- Measurement integrity: an opportunity claiming to come from an Outgrow action must say which one.
alter table public.opportunities add constraint chk_opps_outgrow_has_source
  check (origin <> 'Outgrow action' or source_action_id is not null);

------------------------------------------------------------------ audit trail for restricted / sensitive fields
create or replace function public.audit_changes() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pk text := tg_argv[0];
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  col text;
  i int;
begin
  for i in 1 .. tg_nargs - 1 loop
    col := tg_argv[i];
    if (tg_op = 'INSERT' and n -> col is not null and n -> col <> 'null'::jsonb)
       or (tg_op = 'UPDATE' and (n -> col) is distinct from (o -> col)) then
      insert into public.audit_log (table_name, record_id, field, old_value, new_value, changed_by_id, changed_by_email)
      values (tg_table_name, n ->> pk, col, o ->> col, n ->> col, public.current_person_id(), (select auth.jwt()) ->> 'email');
    end if;
  end loop;
  return null;
end $$;

create trigger trg_audit after insert or update on public.accounts for each row execute function
  public.audit_changes('account_id','ttm_billed_usd','lifetime_billed_usd','share_of_wallet_pct','ext_eng_spend_usd','revenue_trend','tier','account_owner_id','outgrow_owner_id');
create trigger trg_audit after insert or update on public.org_units for each row execute function public.audit_changes('org_unit_id','known_budget_usd');
create trigger trg_audit after insert or update on public.programmes for each row execute function public.audit_changes('programme_id','current_headcount','monthly_run_rate_usd');
create trigger trg_audit after insert or update on public.revenue_periods for each row execute function public.audit_changes('revenue_period_id','billed_amount','billed_amount_usd');
create trigger trg_audit after insert or update on public.opportunities for each row execute function public.audit_changes('opportunity_id','estimated_value_usd','stage','owner_id','competitor_ids');
create trigger trg_audit after insert or update on public.whitespace_map for each row execute function public.audit_changes('whitespace_id','competitor_id','est_annual_value_usd','status');
create trigger trg_audit after insert or update on public.share_of_wallet_readings for each row execute function public.audit_changes('reading_id','stated_share_pct');
create trigger trg_audit after insert or update on public.proof_points for each row execute function public.audit_changes('proof_id','internal_statement','approval_status');
create trigger trg_audit after insert or update on public.competitors for each row execute function public.audit_changes('competitor_id','name','notes');
create trigger trg_audit after update on public.actions for each row execute function public.audit_changes('action_id','estimated_value_usd','action_code');
create trigger trg_audit after insert or update on public.acsia_people for each row execute function
  public.audit_changes('person_id','email','app_role','manager_id','active','weekly_target','show_on_ranked_scorecard','outgrow_role','is_participant');
create trigger trg_audit after insert or update on public.app_settings for each row execute function public.audit_changes('key','value');
create trigger trg_audit after update on public.plays for each row execute function public.audit_changes('play_id','approval_status');
create trigger trg_audit after update on public.scorecard_weeks for each row execute function public.audit_changes('week_id','status','ceo_commentary');
create trigger trg_audit after update on public.ai_routes for each row execute function public.audit_changes('job','primary_model','fallback_model','enabled');
