begin;

-- user_collection is authoritative state. Normal clients may read their own
-- rows, but every mutation must cross a server-authoritative boundary that
-- serializes the write and derives the target account from trusted context.
revoke all privileges on table public.user_collection from public, anon, authenticated;
grant select on table public.user_collection to authenticated;
grant select, insert, update on table public.user_collection to service_role;

-- These policies predate the atomic collection RPCs. Remove them as
-- defense-in-depth so a later broad table grant cannot silently restore the
-- retired direct-write path.
drop policy if exists "Users can insert their own collection" on public.user_collection;
drop policy if exists "Users can update their own collection" on public.user_collection;
drop policy if exists "Users can upsert their own collection" on public.user_collection;
drop policy if exists "Users can sync their own collection" on public.user_collection;
drop policy if exists "Users can delete their own collection" on public.user_collection;
drop policy if exists "Users can reset their own collection" on public.user_collection;
drop policy if exists "Users can clear their own collection" on public.user_collection;

-- Fail closed during deployment if this boundary would block one of the
-- supported collection mutation paths or remove normal collection reads.
do $$
begin
  if has_table_privilege('authenticated', 'public.user_collection', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_collection', 'UPDATE')
    or has_table_privilege('authenticated', 'public.user_collection', 'DELETE')
    or has_table_privilege('authenticated', 'public.user_collection', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.user_collection', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.user_collection', 'TRIGGER')
    or has_table_privilege('authenticated', 'public.user_collection', 'MAINTAIN')
    or has_table_privilege('anon', 'public.user_collection', 'INSERT')
    or has_table_privilege('anon', 'public.user_collection', 'UPDATE')
    or has_table_privilege('anon', 'public.user_collection', 'DELETE')
    or has_table_privilege('anon', 'public.user_collection', 'TRUNCATE')
    or has_table_privilege('anon', 'public.user_collection', 'REFERENCES')
    or has_table_privilege('anon', 'public.user_collection', 'TRIGGER')
    or has_table_privilege('anon', 'public.user_collection', 'MAINTAIN') then
    raise exception 'Direct user_collection mutation privileges remain exposed';
  end if;

  if not has_table_privilege('authenticated', 'public.user_collection', 'SELECT') then
    raise exception 'Authenticated collection reads must remain available';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.increment_collection_cards(jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Atomic pack persistence RPC must remain executable';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.add_scanned_card_once(text,text)',
    'EXECUTE'
  ) then
    raise exception 'Scanner collection RPC must remain executable';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.complete_mobile_onboarding_v1(uuid,integer,text,text[],boolean)',
    'EXECUTE'
  ) then
    raise exception 'Mobile onboarding RPC must remain executable by the backend';
  end if;

  if not has_table_privilege('service_role', 'public.user_collection', 'SELECT')
    or not has_table_privilege('service_role', 'public.user_collection', 'INSERT')
    or not has_table_privilege('service_role', 'public.user_collection', 'UPDATE') then
    raise exception 'Authorized backend collection mutations must remain available';
  end if;
end;
$$;

commit;
