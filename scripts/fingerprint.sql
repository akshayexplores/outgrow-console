-- Structural fingerprint of the public schema: run on local scratch and on the remote project; results must match row for row.
select cat, md5(coalesce(string_agg(v, '|' order by v), '')) as h, count(*) as n from (
  select 'columns' cat, c.table_name||'.'||c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,'') v
    from information_schema.columns c where c.table_schema='public'
  union all select 'constraints', conrelid::regclass||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
  union all select 'indexes', indexdef from pg_indexes where schemaname='public'
  union all select 'functions', p.oid::regprocedure::text||':'||p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'')||':'||
       md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g'))
       from pg_proc p where p.pronamespace='public'::regnamespace
  union all select 'policies', tablename||':'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public'
  union all select 'views', c.relname||':'||coalesce(c.reloptions::text,'')||':'||md5(regexp_replace(pg_get_viewdef(c.oid), '\s+', '', 'g')) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v'
  union all select 'triggers', n.nspname||'.'||c.relname||':'||tgname||':'||md5(regexp_replace(pg_get_triggerdef(t.oid), '\s+', '', 'g')) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not tgisinternal and (n.nspname='public' or (n.nspname='auth' and c.relname='users'))
  union all select 'rls', relname||':'||relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relkind='r'
  union all select 'table_grants', grantee||':'||table_name||':'||privilege_type from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated','service_role','supabase_auth_admin')
  union all select 'column_grants', grantee||':'||table_name||':'||column_name||':'||privilege_type from information_schema.column_privileges
       where table_schema='public' and grantee in ('anon','authenticated','service_role','supabase_auth_admin') and privilege_type in ('SELECT','INSERT','UPDATE')
         and not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=column_privileges.table_name and g.grantee=column_privileges.grantee and g.privilege_type=column_privileges.privilege_type)
  union all select 'fn_grants', p.oid::regprocedure::text||':'||case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end||':'||a.privilege_type
       from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.pronamespace='public'::regnamespace and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated','service_role','supabase_auth_admin'))
  union all select 'comments', c.relname||'.'||a.attname||':'||coalesce(d.description,'') from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 left join pg_description d on d.objoid=c.oid and d.objsubid=a.attnum
       where c.relnamespace='public'::regnamespace and c.relkind='r' and d.description is not null
  union all select 'settings', key||':'||value from public.app_settings
) q group by cat order by cat
