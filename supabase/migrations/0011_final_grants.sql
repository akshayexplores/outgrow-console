-- Final pass: nothing executable by PUBLIC/anon; the server-side service role keeps full access (it bypasses RLS by design and is never exposed to browsers).
revoke execute on all functions in schema public from public, anon;
revoke all on all tables in schema public from anon;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- the sign-up gate is the one function the auth service (not clients) may call
grant usage on schema public to supabase_auth_admin;   -- Supabase docs: the auth service needs schema usage to call the hook
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
