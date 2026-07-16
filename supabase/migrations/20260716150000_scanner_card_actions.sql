-- One authenticated scanner addition per stable catalog card ID.
-- Normal pack increments continue through increment_collection_cards(jsonb),
-- which is intentionally left unchanged by this migration.
create table if not exists public.user_scanner_card_additions (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  set_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id),
  constraint user_scanner_card_additions_card_id_nonempty
    check (length(trim(card_id)) between 1 and 200),
  constraint user_scanner_card_additions_set_id_nonempty
    check (length(trim(set_id)) between 1 and 120)
);

alter table public.user_scanner_card_additions enable row level security;

revoke all on table public.user_scanner_card_additions from public, anon, authenticated;
grant select on table public.user_scanner_card_additions to authenticated;
grant select, insert, delete on table public.user_scanner_card_additions to service_role;

drop policy if exists "Users can read their own scanner additions"
  on public.user_scanner_card_additions;
create policy "Users can read their own scanner additions"
  on public.user_scanner_card_additions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.add_scanned_card_once(
  p_card_id text,
  p_set_id text
)
returns table(added boolean, already_added boolean, quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_card_id text := trim(coalesce(p_card_id, ''));
  v_set_id text := trim(coalesce(p_set_id, ''));
  v_receipt_inserted boolean := false;
  v_collection_row_was_new boolean := false;
  v_quantity integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(v_card_id) not between 1 and 200 then
    raise exception 'Invalid card ID' using errcode = '22023';
  end if;
  if length(v_set_id) not between 1 and 120 then
    raise exception 'Invalid set ID' using errcode = '22023';
  end if;

  -- Use the same per-user lock as increment_collection_cards so pack and
  -- scanner mutations cannot race collection quantities or profile counters.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  insert into public.user_scanner_card_additions(user_id, card_id, set_id)
  values (v_user_id, v_card_id, v_set_id)
  on conflict (user_id, card_id) do nothing;
  get diagnostics v_quantity = row_count;
  v_receipt_inserted := v_quantity > 0;

  if not v_receipt_inserted then
    select coalesce(stored.quantity, 0)
      into v_quantity
    from public.user_collection as stored
    where stored.user_id = v_user_id
      and stored.card_id = v_card_id;

    return query select false, true, coalesce(v_quantity, 0);
    return;
  end if;

  select not exists (
    select 1
    from public.user_collection as stored
    where stored.user_id = v_user_id
      and stored.set_id = v_set_id
      and stored.card_id = v_card_id
  ) into v_collection_row_was_new;

  insert into public.user_collection as target(user_id, set_id, card_id, quantity)
  values (v_user_id, v_set_id, v_card_id, 1)
  on conflict (user_id, set_id, card_id) do update
    set quantity = target.quantity + 1,
        updated_at = now()
  returning target.quantity into v_quantity;

  insert into public.user_profile_stats as stats_row(user_id, total_cards_pulled, unique_cards)
  values (v_user_id, 1, case when v_collection_row_was_new then 1 else 0 end)
  on conflict (user_id) do update
    set total_cards_pulled = stats_row.total_cards_pulled + 1,
        unique_cards = stats_row.unique_cards + excluded.unique_cards,
        updated_at = now();

  return query select true, false, v_quantity;
end;
$$;

revoke all on function public.add_scanned_card_once(text, text) from public, anon;
grant execute on function public.add_scanned_card_once(text, text) to authenticated;

-- Keep explicit transactional account cleanup aligned with the cascading FK.
create or replace function public.delete_packdex_account_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    raise exception 'A target user id is required' using errcode = '22023';
  end if;

  delete from public.user_scanner_card_additions where user_id = target_user_id;
  delete from public.user_wishlist where user_id = target_user_id;
  delete from public.user_achievements where user_id = target_user_id;
  delete from public.user_binders where user_id = target_user_id;
  delete from public.user_collection_increment_events where user_id = target_user_id;
  delete from public.user_pack_open_events where user_id = target_user_id;
  delete from public.user_welcome_rewards where user_id = target_user_id;
  delete from public.user_profile_stats where user_id = target_user_id;
  delete from public.user_collection where user_id = target_user_id;
end;
$$;

revoke all on function public.delete_packdex_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_packdex_account_data(uuid) to service_role;
