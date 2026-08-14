-- =====================================================================
-- Outgrow Console — Supabase schema
-- Run this once in the Supabase SQL editor, then paste your project URL
-- and anon key into config.js.
--
-- One row holds the whole workspace as JSON. At Acsia's scale — tens of
-- accounts, a few hundred actions a month — a document is simpler,
-- atomic and trivial to export. If concurrent editing ever becomes a
-- real problem, split `actions` into its own table first; that is the
-- only collection with meaningful write contention.
-- =====================================================================

create table if not exists public.outgrow_state (
  id          text primary key,
  doc         jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.outgrow_state enable row level security;

-- ---------------------------------------------------------------------
-- OPEN ACCESS POLICY — anyone with the anon key and the deployment URL
-- can read and write. That is a deliberate choice for an internal tool
-- behind an unlisted Vercel URL with no authentication, and it is the
-- fastest way to get a pilot running.
--
-- It is NOT appropriate once real customer contact detail is in here.
-- Before that point, do one of:
--   (a) turn on Supabase Auth and replace `true` with
--       `auth.role() = 'authenticated'`, or
--   (b) put the Vercel deployment behind Vercel Authentication
--       (Project → Settings → Deployment Protection).
-- Option (b) takes about a minute and is the pragmatic first step.
-- ---------------------------------------------------------------------
drop policy if exists outgrow_state_rw on public.outgrow_state;
create policy outgrow_state_rw
  on public.outgrow_state
  for all
  using (true)
  with check (true);

-- Optional: keep a rolling history so a bad import can be undone.
create table if not exists public.outgrow_state_history (
  id          bigserial primary key,
  state_id    text not null,
  doc         jsonb not null,
  saved_at    timestamptz not null default now()
);

alter table public.outgrow_state_history enable row level security;
drop policy if exists outgrow_history_rw on public.outgrow_state_history;
create policy outgrow_history_rw
  on public.outgrow_state_history for all using (true) with check (true);

create or replace function public.outgrow_snapshot()
returns trigger language plpgsql as $$
begin
  insert into public.outgrow_state_history (state_id, doc)
  values (old.id, old.doc);
  -- keep the most recent 50 snapshots per workspace
  delete from public.outgrow_state_history
  where id in (
    select id from public.outgrow_state_history
    where state_id = old.id
    order by saved_at desc
    offset 50
  );
  return new;
end $$;

drop trigger if exists outgrow_state_snapshot on public.outgrow_state;
create trigger outgrow_state_snapshot
  before update on public.outgrow_state
  for each row execute function public.outgrow_snapshot();
