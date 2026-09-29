-- "Remove examples": one click deletes every row flagged is_example AND everything that depends on those rows
-- (touches, actions, opportunities... logged against example accounts/people during a demo).
-- Returns per-table counts and the auth user ids of removed example people so the app can delete those auth users.

create or replace function public.count_examples() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; out jsonb := '{}'::jsonb; n bigint;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  for r in select c.table_name from information_schema.columns c join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'is_example' loop
    execute format('select count(*) from public.%I where is_example', r.table_name) into n;
    if n > 0 then out := out || jsonb_build_object(r.table_name, n); end if;
  end loop;
  return out;
end $$;

create or replace function public.remove_examples() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record; n bigint; changed boolean; rounds int := 0; progress boolean;
  removed jsonb := '{}'::jsonb; auth_ids uuid[];
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: only the admin can remove examples' using errcode = '42501'; end if;

  drop table if exists _pk; drop table if exists _fk;
  create temp table _pk (tbl text not null, pk uuid not null, primary key (tbl, pk)) on commit drop;
  create temp table _fk on commit drop as
    select (select relname::text from pg_class where oid = con.conrelid) as child, (select relname::text from pg_class where oid = con.confrelid) as parent,
           (select attname from pg_attribute where attrelid = con.conrelid and attnum = con.conkey[1]) as child_col,
           (select attname from pg_attribute where attrelid = con.confrelid and attnum = con.confkey[1]) as parent_col,
           (select attnotnull from pg_attribute where attrelid = con.conrelid and attnum = con.conkey[1]) as child_notnull,
           (select atttypid::regtype::text from pg_attribute where attrelid = con.confrelid and attnum = con.confkey[1]) as parent_type,
           (select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
             where i.indrelid = con.conrelid and i.indisprimary and i.indnatts = 1 and a.atttypid = 'uuid'::regtype) as child_pk
    from pg_constraint con
    where con.contype = 'f' and con.connamespace = 'public'::regnamespace and array_length(con.conkey, 1) = 1;

  -- 1. seed: every example row in a table with a single uuid primary key
  for r in select c.table_name, a.attname as pkcol
           from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           join pg_index i on i.indrelid = ('public.' || quote_ident(c.table_name))::regclass and i.indisprimary and i.indnatts = 1
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] and a.atttypid = 'uuid'::regtype
           where c.table_schema = 'public' and c.column_name = 'is_example' loop
    execute format('insert into _pk select %L, %I from public.%I where is_example on conflict do nothing', r.table_name, r.pkcol, r.table_name);
  end loop;

  select coalesce(array_agg(auth_user_id), '{}') into auth_ids from public.acsia_people p
   where auth_user_id is not null and exists (select 1 from _pk where tbl = 'acsia_people' and pk = p.person_id);

  -- 2. expand to dependents until nothing new appears
  loop
    changed := false;
    for r in select f.child, f.child_col, f.parent, f.parent_col, f.child_pk from _fk f
             where f.child_pk is not null and f.parent_type = 'uuid' and exists (select 1 from _pk where tbl = f.parent) loop
      execute format('insert into _pk select %L, c.%I from public.%I c where c.%I in (select pk from _pk where tbl = %L) on conflict do nothing',
                     r.child, r.child_pk, r.child, r.child_col, r.parent);
      get diagnostics n = row_count;
      if n > 0 then changed := true; end if;
    end loop;
    exit when not changed;
  end loop;

  -- 3. break cycles: null every nullable FK that points from one doomed row to another doomed row
  for r in select f.* from _fk f where f.child_pk is not null and not f.child_notnull and f.parent_type = 'uuid' loop
    execute format('update public.%I c set %I = null where c.%I in (select pk from _pk where tbl = %L) and c.%I in (select pk from _pk where tbl = %L)',
                   r.child, r.child_col, r.child_pk, r.child, r.child_col, r.parent);
  end loop;

  -- 4. delete, repeating until every table is clear (referencing tables go first because deletes that would violate an FK are skipped and retried)
  loop
    progress := false;
    for r in select tbl, count(*) c from _pk group by tbl loop
      begin
        execute format('delete from public.%I where %I in (select pk from _pk where tbl = %L)', r.tbl,
                       (select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                         where i.indrelid = ('public.' || quote_ident(r.tbl))::regclass and i.indisprimary), r.tbl);
        get diagnostics n = row_count;
        if n > 0 then
          removed := removed || jsonb_build_object(r.tbl, coalesce((removed ->> r.tbl)::bigint, 0) + n);
          delete from _pk where tbl = r.tbl;
          progress := true;
        end if;
      exception when foreign_key_violation then
        null;
      end;
    end loop;
    rounds := rounds + 1;
    exit when not exists (select 1 from _pk) or not progress or rounds > 40;
  end loop;

  if exists (select 1 from _pk) then
    raise exception 'REMOVE_INCOMPLETE: could not remove all example rows (%)', (select string_agg(distinct tbl, ', ') from _pk);
  end if;
  update public.app_settings set value = 'false' where key = 'examples_loaded';
  return jsonb_build_object('removed', removed, 'auth_user_ids', to_jsonb(auth_ids));
end $$;

grant execute on function public.count_examples(), public.remove_examples() to authenticated;
