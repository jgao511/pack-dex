create table if not exists public.user_collection_increment_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_event_id),
  constraint user_collection_increment_events_id_nonempty
    check (length(trim(client_event_id)) between 1 and 160)
);

alter table public.user_collection_increment_events enable row level security;
revoke all on public.user_collection_increment_events from public, anon, authenticated;
grant select, insert on public.user_collection_increment_events to service_role;

alter table public.user_profile_stats
  add column if not exists unique_cards integer not null default 0,
  add column if not exists sets_completed integer not null default 0;

insert into public.user_profile_stats as stats(user_id, total_cards_pulled, unique_cards)
select user_id, coalesce(sum(quantity), 0)::integer, count(*)::integer
from public.user_collection
where quantity > 0
group by user_id
on conflict (user_id) do update
  set total_cards_pulled = greatest(stats.total_cards_pulled, excluded.total_cards_pulled),
      unique_cards = excluded.unique_cards,
      updated_at = now();

insert into public.user_profile_stats as stats(user_id, packs_opened)
select user_id, count(*)::integer
from public.user_pack_open_events
group by user_id
on conflict (user_id) do update
  set packs_opened = greatest(stats.packs_opened, excluded.packs_opened),
      updated_at = now();

create or replace function public.increment_collection_cards(batches jsonb)
returns table(client_event_id text, set_id text, card_id text, quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  batch jsonb;
  batch_id text;
  batch_cards jsonb;
  inserted_event_id text;
  batch_card_count integer;
  batch_quantity integer;
  inserted_unique_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(batches) <> 'array' or jsonb_array_length(batches) < 1 or jsonb_array_length(batches) > 50 then
    raise exception 'batches must contain between 1 and 50 items' using errcode = '22023';
  end if;
  if (select coalesce(sum(jsonb_array_length(value->'cards')), 0) from jsonb_array_elements(batches)) > 500 then
    raise exception 'At most 500 card rows may be submitted' using errcode = '22023';
  end if;

  for batch in select value from jsonb_array_elements(batches)
  loop
    batch_id := trim(coalesce(batch->>'client_event_id', ''));
    batch_cards := batch->'cards';
    if length(batch_id) < 1 or length(batch_id) > 160 then
      raise exception 'Invalid client_event_id' using errcode = '22023';
    end if;
    if jsonb_typeof(batch_cards) <> 'array' or jsonb_array_length(batch_cards) < 1 or jsonb_array_length(batch_cards) > 100 then
      raise exception 'Each batch must contain between 1 and 100 cards' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(batch_cards) card
      where length(trim(coalesce(card->>'set_id', ''))) not between 1 and 120
         or length(trim(coalesce(card->>'card_id', ''))) not between 1 and 200
         or coalesce((card->>'quantity')::integer, 0) not between 1 and 100
    ) then
      raise exception 'Invalid collection card payload' using errcode = '22023';
    end if;

    inserted_event_id := null;
    insert into public.user_collection_increment_events(user_id, client_event_id)
    values (current_user_id, batch_id)
    on conflict do nothing
    returning user_collection_increment_events.client_event_id into inserted_event_id;

    if inserted_event_id is null then
      client_event_id := batch_id;
      set_id := null;
      card_id := null;
      quantity := null;
      return next;
      continue;
    end if;

    with grouped as (
      select trim(card->>'set_id') as set_id,
             trim(card->>'card_id') as card_id,
             sum((card->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(batch_cards) card
      group by 1, 2
    ), existing as (
      select g.*, (uc.card_id is null) as is_new
      from grouped g
      left join public.user_collection uc
        on uc.user_id = current_user_id and uc.set_id = g.set_id and uc.card_id = g.card_id
    ), changed as (
      insert into public.user_collection as uc(user_id, set_id, card_id, quantity)
      select current_user_id, e.set_id, e.card_id, e.quantity from existing e
      on conflict (user_id, set_id, card_id) do update
        set quantity = uc.quantity + excluded.quantity,
            updated_at = now()
      returning uc.set_id, uc.card_id, uc.quantity
    )
    select count(*), coalesce(sum(e.quantity), 0), count(*) filter (where e.is_new)
      into batch_card_count, batch_quantity, inserted_unique_count
    from existing e;

    insert into public.user_profile_stats as stats(user_id, total_cards_pulled, unique_cards)
    values (current_user_id, batch_quantity, inserted_unique_count)
    on conflict (user_id) do update
      set total_cards_pulled = stats.total_cards_pulled + excluded.total_cards_pulled,
          unique_cards = stats.unique_cards + excluded.unique_cards,
          updated_at = now();

    return query
      select batch_id, uc.set_id, uc.card_id, uc.quantity
      from public.user_collection uc
      join (
        select distinct trim(card->>'set_id') as set_id, trim(card->>'card_id') as card_id
        from jsonb_array_elements(batch_cards) card
      ) submitted using (set_id, card_id)
      where uc.user_id = current_user_id;
  end loop;
end;
$$;

revoke all on function public.increment_collection_cards(jsonb) from public, anon;
grant execute on function public.increment_collection_cards(jsonb) to authenticated;

create or replace function public.record_pack_open_event(
  p_client_event_id text,
  p_set_id text default '',
  p_opened_at timestamptz default now()
)
returns table(recorded boolean, packs_opened integer, total_cards_pulled integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_count integer;
  was_inserted boolean;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_client_event_id, ''))) not between 1 and 160 then
    raise exception 'Invalid client_event_id' using errcode = '22023';
  end if;

  insert into public.user_pack_open_events(user_id, client_event_id, set_id, opened_at)
  values (current_user_id, trim(p_client_event_id), left(coalesce(p_set_id, ''), 120), coalesce(p_opened_at, now()))
  on conflict (user_id, client_event_id) do nothing;
  get diagnostics inserted_count = row_count;
  was_inserted := inserted_count > 0;

  if was_inserted then
    insert into public.user_profile_stats as stats(user_id, packs_opened)
    values (current_user_id, 1)
    on conflict (user_id) do update
      set packs_opened = stats.packs_opened + 1,
          updated_at = now();
  end if;

  return query
    select was_inserted, stats.packs_opened, stats.total_cards_pulled
    from public.user_profile_stats stats
    where stats.user_id = current_user_id;
end;
$$;

revoke all on function public.record_pack_open_event(text, text, timestamptz) from public, anon;
grant execute on function public.record_pack_open_event(text, text, timestamptz) to authenticated, service_role;

-- Existing constraints/indexes are sufficient and intentionally not duplicated:
-- user_pack_open_events_user_id_created_at_idx supports user/date scans.
-- user_pack_open_events(user_id, client_event_id) is unique.
-- user_collection(user_id, set_id, card_id) is unique and supports collection upserts.
