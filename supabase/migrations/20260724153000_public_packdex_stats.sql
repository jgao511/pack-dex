-- A single append-only aggregate keeps the public welcome-page statistic fast
-- and prevents collection or account deletion from reducing lifetime activity.
begin;

create table if not exists public.packdex_public_stats (
  singleton boolean primary key default true,
  cards_pulled bigint not null default 0 check (cards_pulled >= 0),
  packs_opened bigint not null default 0 check (packs_opened >= 0),
  updated_at timestamptz not null default now(),
  constraint packdex_public_stats_singleton check (singleton)
);

alter table public.packdex_public_stats enable row level security;
revoke all on table public.packdex_public_stats from public, anon, authenticated;
grant select, insert, update on table public.packdex_public_stats to service_role;

-- Hold activity writes while the starting snapshot and its triggers are
-- installed, so no accepted event can fall between the two.
lock table public.user_collection_increment_events in share row exclusive mode;
lock table public.user_pack_open_events in share row exclusive mode;
lock table public.user_welcome_rewards in share row exclusive mode;
lock table public.user_profile_stats in share row exclusive mode;

-- Collection receipts historically did not retain their accepted quantity.
-- user_profile_stats is the closest reliable append-only source for the
-- starting cards value; pack events remain the authoritative pack count.
insert into public.packdex_public_stats(singleton, cards_pulled, packs_opened, updated_at)
select
  true,
  coalesce((
    select sum(greatest(coalesce(stats.total_cards_pulled, 0), 0))::bigint
    from public.user_profile_stats as stats
  ), 0),
  coalesce((
    select count(*)::bigint
    from public.user_pack_open_events
  ), 0),
  now()
on conflict (singleton) do nothing;

alter table public.user_collection_increment_events
  add column if not exists cards_added integer not null default 0,
  add constraint user_collection_increment_events_cards_added_nonnegative
    check (cards_added >= 0) not valid;

alter table public.user_collection_increment_events
  validate constraint user_collection_increment_events_cards_added_nonnegative;

create or replace function public.increment_packdex_public_cards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.cards_added > 0 then
    insert into public.packdex_public_stats as stats(singleton, cards_pulled, packs_opened, updated_at)
    values (true, new.cards_added, 0, now())
    on conflict (singleton) do update
      set cards_pulled = stats.cards_pulled + excluded.cards_pulled,
          updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.increment_packdex_public_cards() from public, anon, authenticated;

drop trigger if exists increment_packdex_public_cards
  on public.user_collection_increment_events;
create trigger increment_packdex_public_cards
after insert on public.user_collection_increment_events
for each row
execute function public.increment_packdex_public_cards();

create or replace function public.increment_packdex_public_welcome_cards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reward_card_count integer := 0;
begin
  if jsonb_typeof(new.welcome_reward_cards) = 'array' then
    reward_card_count := jsonb_array_length(new.welcome_reward_cards);
  end if;

  if reward_card_count > 0 then
    insert into public.packdex_public_stats as stats(singleton, cards_pulled, packs_opened, updated_at)
    values (true, reward_card_count, 0, now())
    on conflict (singleton) do update
      set cards_pulled = stats.cards_pulled + excluded.cards_pulled,
          updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.increment_packdex_public_welcome_cards() from public, anon, authenticated;

drop trigger if exists increment_packdex_public_welcome_cards
  on public.user_welcome_rewards;
create trigger increment_packdex_public_welcome_cards
after update of welcome_reward_cards_saved_at on public.user_welcome_rewards
for each row
when (
  old.welcome_reward_cards_saved_at is null
  and new.welcome_reward_cards_saved_at is not null
)
execute function public.increment_packdex_public_welcome_cards();

create or replace function public.increment_packdex_public_packs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.packdex_public_stats as stats(singleton, cards_pulled, packs_opened, updated_at)
  values (true, 0, 1, now())
  on conflict (singleton) do update
    set packs_opened = stats.packs_opened + 1,
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.increment_packdex_public_packs() from public, anon, authenticated;

drop trigger if exists increment_packdex_public_packs
  on public.user_pack_open_events;
create trigger increment_packdex_public_packs
after insert on public.user_pack_open_events
for each row
execute function public.increment_packdex_public_packs();

create or replace function public.increment_collection_cards(batches jsonb)
returns table(client_event_id text, set_id text, card_id text, quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch jsonb;
  v_event_id text;
  v_cards jsonb;
  v_inserted_event_id text;
  v_total_quantity integer;
  v_new_card_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if jsonb_typeof($1) <> 'array' or jsonb_array_length($1) not between 1 and 50 then
    raise exception 'batches must contain between 1 and 50 items' using errcode = '22023';
  end if;
  if (select coalesce(sum(jsonb_array_length(batch_item.value -> 'cards')), 0)
      from jsonb_array_elements($1) as batch_item(value)) > 500 then
    raise exception 'At most 500 card rows may be submitted' using errcode = '22023';
  end if;

  for v_batch in select batch_item.value from jsonb_array_elements($1) as batch_item(value)
  loop
    v_event_id := trim(coalesce(v_batch ->> 'client_event_id', ''));
    v_cards := v_batch -> 'cards';
    if length(v_event_id) not between 1 and 160
       or jsonb_typeof(v_cards) <> 'array'
       or jsonb_array_length(v_cards) not between 1 and 100 then
      raise exception 'Invalid collection batch' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_cards) as payload_card(value)
      where length(trim(coalesce(payload_card.value ->> 'set_id', ''))) not between 1 and 120
         or length(trim(coalesce(payload_card.value ->> 'card_id', ''))) not between 1 and 200
         or coalesce((payload_card.value ->> 'quantity')::integer, 0) not between 1 and 100
    ) then
      raise exception 'Invalid collection card payload' using errcode = '22023';
    end if;

    select coalesce(sum((payload_card.value ->> 'quantity')::integer), 0)::integer
      into v_total_quantity
    from jsonb_array_elements(v_cards) as payload_card(value);

    v_inserted_event_id := null;
    insert into public.user_collection_increment_events as event_row(
      user_id,
      client_event_id,
      cards_added
    )
    values (v_user_id, v_event_id, v_total_quantity)
    on conflict on constraint user_collection_increment_events_pkey do nothing
    returning event_row.client_event_id into v_inserted_event_id;

    if v_inserted_event_id is null then
      return query select v_event_id, null::text, null::text, null::integer;
      continue;
    end if;

    with grouped_cards as (
      select trim(payload_card.value ->> 'set_id') as grouped_set_id,
             trim(payload_card.value ->> 'card_id') as grouped_card_id,
             sum((payload_card.value ->> 'quantity')::integer)::integer as grouped_quantity
      from jsonb_array_elements(v_cards) as payload_card(value)
      group by trim(payload_card.value ->> 'set_id'), trim(payload_card.value ->> 'card_id')
    ), new_cards as (
      select grouped.grouped_set_id, grouped.grouped_card_id, grouped.grouped_quantity,
             (stored.card_id is null) as is_new
      from grouped_cards as grouped
      left join public.user_collection as stored
        on stored.user_id = v_user_id
       and stored.set_id = grouped.grouped_set_id
       and stored.card_id = grouped.grouped_card_id
    ), applied_cards as (
      insert into public.user_collection as target(user_id, set_id, card_id, quantity)
      select v_user_id, new_card.grouped_set_id, new_card.grouped_card_id, new_card.grouped_quantity
      from new_cards as new_card
      on conflict on constraint user_collection_user_id_set_id_card_id_key do update
        set quantity = target.quantity + excluded.quantity,
            updated_at = now()
      returning target.set_id, target.card_id, target.quantity
    )
    select count(*) filter (where new_card.is_new)::integer
      into v_new_card_count
    from new_cards as new_card;

    insert into public.user_profile_stats as stats_row(user_id, total_cards_pulled, unique_cards)
    values (v_user_id, v_total_quantity, v_new_card_count)
    on conflict (user_id) do update
      set total_cards_pulled = stats_row.total_cards_pulled + excluded.total_cards_pulled,
          unique_cards = stats_row.unique_cards + excluded.unique_cards,
          updated_at = now();

    return query
      select v_event_id, stored.set_id, stored.card_id, stored.quantity
      from public.user_collection as stored
      join (
        select distinct trim(payload_card.value ->> 'set_id') as submitted_set_id,
               trim(payload_card.value ->> 'card_id') as submitted_card_id
        from jsonb_array_elements(v_cards) as payload_card(value)
      ) as submitted
        on stored.set_id = submitted.submitted_set_id
       and stored.card_id = submitted.submitted_card_id
      where stored.user_id = v_user_id;
  end loop;
end;
$$;

revoke all on function public.increment_collection_cards(jsonb) from public, anon;
grant execute on function public.increment_collection_cards(jsonb) to authenticated;

create or replace function public.get_public_packdex_stats()
returns table(cards_pulled bigint, packs_opened bigint, updated_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select stats.cards_pulled, stats.packs_opened, stats.updated_at
  from public.packdex_public_stats as stats
  where stats.singleton = true
  limit 1;
$$;

revoke all on function public.get_public_packdex_stats() from public;
grant execute on function public.get_public_packdex_stats() to anon, authenticated;

commit;
