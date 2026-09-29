-- App tables on top of the data model: auth link + app role, settings, capture inbox, notifications, AI operator, cron runs.

------------------------------------------------------------------ settings
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
comment on table public.app_settings is 'Key/value settings. admin_email = the ONE email allowed into /admin (copied from env ADMIN_EMAIL by the seed script). allowed_email_domain = optional second sign-up gate.';
insert into public.app_settings (key, value) values
  ('admin_email', ''),
  ('allowed_email_domain', ''),
  ('timezone', 'Asia/Kolkata'),
  ('week_start', 'Monday'),
  ('scorecard_publish_time', '14:00'),
  ('examples_loaded', 'false')
on conflict (key) do nothing;

------------------------------------------------------------------ employees <-> auth
alter table public.acsia_people
  add column if not exists auth_user_id uuid unique,
  add column if not exists app_role text not null default 'engineer'
    check (app_role in ('engineer','pm','delivery_lead','ae','sdr','presales','marketing','leader','ceo')),
  add column if not exists invited_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists welcomed_at timestamptz;
create unique index if not exists acsia_people_email_lower_uidx on public.acsia_people (lower(email));
create index if not exists acsia_people_manager_idx on public.acsia_people (manager_id);
create index if not exists acsia_people_auth_idx on public.acsia_people (auth_user_id);
comment on column public.acsia_people.app_role is 'Drives navigation and permissions (read from the DB on every request, never from JWT claims).';

------------------------------------------------------------------ engineer capture inbox
create table if not exists public.capture_inbox (
  id uuid primary key default gen_random_uuid(),
  from_person_id uuid not null references public.acsia_people(person_id),
  to_manager_id uuid references public.acsia_people(person_id),
  channel text not null default 'web' check (channel in ('web','teams','whatsapp','voice')),
  text text not null check (length(btrim(text)) between 1 and 2000),
  audio_path text,
  status text not null default 'new' check (status in ('new','logged','dismissed')),
  touch_id uuid references public.touches(touch_id),
  logged_by_id uuid references public.acsia_people(person_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_example boolean not null default false
);
create index if not exists capture_inbox_from_idx on public.capture_inbox (from_person_id, created_at desc);
create index if not exists capture_inbox_mgr_idx on public.capture_inbox (to_manager_id, status);

------------------------------------------------------------------ notifications (in-app only in this build)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.acsia_people(person_id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  is_example boolean not null default false
);
create index if not exists notifications_person_idx on public.notifications (person_id, created_at desc);

------------------------------------------------------------------ AI operator
create table if not exists public.ai_routes (
  job text primary key check (job in ('capture','transcribe','follow','brief','plan','score','coach','guard','analyst')),
  primary_model text not null,
  fallback_model text,
  temperature numeric(3,2) not null default 0.2,
  max_tokens integer not null default 1200,
  enabled boolean not null default true,
  human_role text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  model text not null,
  person_id uuid references public.acsia_people(person_id),
  input_ref jsonb,
  prompt_hash text,
  output jsonb,
  status text not null check (status in ('ok','invalid_output','error','fallback_used','blocked_by_guardrail','rate_limited','budget_exceeded')),
  error text,
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10,5),
  accepted boolean,
  created_at timestamptz not null default now()
);
create index if not exists ai_runs_person_time_idx on public.ai_runs (person_id, created_at desc);
create index if not exists ai_runs_job_time_idx on public.ai_runs (job, created_at desc);
create index if not exists ai_runs_time_idx on public.ai_runs (created_at desc);

------------------------------------------------------------------ cron idempotency
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  period_key text not null,
  status text not null default 'running' check (status in ('running','ok','error','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detail jsonb,
  unique (job, period_key)
);
