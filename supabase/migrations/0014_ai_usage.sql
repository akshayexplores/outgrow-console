-- One round trip for the operator's per-call checks: rate-limit counters (per person) and this month's spend (whole app).
-- Callable only by the server-side service role; browsers never see it.
create or replace function public.ai_usage(p_person uuid, p_month_start timestamptz)
returns table (last_minute integer, last_day integer, month_cost numeric)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::int from public.ai_runs r
       where r.person_id = p_person and r.status <> 'rate_limited' and r.created_at >= now() - interval '1 minute'
         and r.job in ('capture','follow','brief','coach','guard','transcribe')),
    (select count(*)::int from public.ai_runs r
       where r.person_id = p_person and r.status <> 'rate_limited' and r.created_at >= now() - interval '1 day'
         and r.job in ('capture','follow','brief','coach','guard','transcribe')),
    (select coalesce(sum(r.cost_usd), 0) from public.ai_runs r where r.created_at >= p_month_start)
$$;
revoke execute on function public.ai_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_usage(uuid, timestamptz) to service_role;
