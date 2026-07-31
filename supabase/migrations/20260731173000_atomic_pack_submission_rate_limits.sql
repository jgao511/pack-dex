-- A normal completed pack is now one atomic submission: collection rows, the
-- pack-open event, profile stats, and rate limiting all share the existing
-- per-user transaction lock and client event id.

create table if not exists public.user_pack_open_rate_limit_rejections (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rejected_at timestamptz not null default clock_timestamp(),
  reason text not null,
  client_event_id text not null,
  constraint user_pack_open_rate_limit_rejections_reason_check
    check (reason in ('pack_rate_limit_one_second', 'pack_rate_limit_sixty_seconds')),
  constraint user_pack_open_rate_limit_rejections_event_id_nonempty
    check (length(trim(client_event_id)) between 1 and 160)
);

create index if not exists user_pack_open_rate_limit_rejections_user_time_idx
  on public.user_pack_open_rate_limit_rejections(user_id, rejected_at desc);

alter table public.user_pack_open_rate_limit_rejections enable row level security;
revoke all on public.user_pack_open_rate_limit_rejections from public, anon, authenticated;
grant select, insert on public.user_pack_open_rate_limit_rejections to service_role;

drop function if exists public.increment_collection_cards(jsonb);

create function public.increment_collection_cards(batches jsonb)
returns table(
  client_event_id text,
  set_id text,
  card_id text,
  quantity integer,
  accepted boolean,
  rejection_reason text,
  recorded boolean,
  packs_opened integer,
  total_cards_pulled integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch jsonb;
  v_event_id text;
  v_cards jsonb;
  v_set_id text;
  v_total_quantity integer;
  v_new_card_count integer := 0;
  v_collection_exists boolean;
  v_pack_event_exists boolean;
  v_now timestamptz;
  v_reason text;
  v_packs_opened integer := 0;
  v_total_cards_pulled integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- One RPC call represents exactly one completed pack. This prevents a mixed
  -- result where one item in a multi-pack request is accepted and another is not.
  if jsonb_typeof($1) <> 'array' or jsonb_array_length($1) <> 1 then
    raise exception 'Exactly one completed pack must be submitted' using errcode = '22023';
  end if;

  v_batch := $1 -> 0;
  v_event_id := trim(coalesce(v_batch ->> 'client_event_id', ''));
  v_cards := v_batch -> 'cards';

  if length(v_event_id) not between 1 and 160
     or jsonb_typeof(v_cards) <> 'array'
     or jsonb_array_length(v_cards) not between 1 and 100 then
    raise exception 'Invalid completed pack payload' using errcode = '22023';
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

  select trim(payload_card.value ->> 'set_id')
    into v_set_id
  from jsonb_array_elements(v_cards) as payload_card(value)
  limit 1;

  if exists (
    select 1
    from jsonb_array_elements(v_cards) as payload_card(value)
    where trim(payload_card.value ->> 'set_id') <> v_set_id
  ) then
    raise exception 'A completed pack may contain cards from only one set' using errcode = '22023';
  end if;

  select coalesce(sum((payload_card.value ->> 'quantity')::integer), 0)::integer
    into v_total_quantity
  from jsonb_array_elements(v_cards) as payload_card(value);

  -- The existing lock is deliberately shared with scanner writes and makes the
  -- rate check plus all normal pack writes indivisible for this authenticated user.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select exists (
    select 1 from public.user_collection_increment_events as event_row
    where event_row.user_id = v_user_id
      and event_row.client_event_id = v_event_id
  ) into v_collection_exists;

  select exists (
    select 1 from public.user_pack_open_events as pack_event
    where pack_event.user_id = v_user_id
      and pack_event.client_event_id = v_event_id
  ) into v_pack_event_exists;

  -- Retries of the same stable event id are idempotent and are not fresh pack
  -- submissions. Legacy half-completed queue entries are repaired below.
  if not v_collection_exists and not v_pack_event_exists then
    v_now := clock_timestamp();

    if exists (
      select 1
      from public.user_pack_open_events as recent_event
      where recent_event.user_id = v_user_id
        and recent_event.created_at > v_now - interval '1 second'
    ) then
      v_reason := 'pack_rate_limit_one_second';
    elsif (
      select count(*)
      from public.user_pack_open_events as recent_event
      where recent_event.user_id = v_user_id
        and recent_event.created_at > v_now - interval '60 seconds'
    ) >= 30 then
      v_reason := 'pack_rate_limit_sixty_seconds';
    end if;

    if v_reason is not null then
      insert into public.user_pack_open_rate_limit_rejections(
        user_id,
        rejected_at,
        reason,
        client_event_id
      ) values (v_user_id, v_now, v_reason, v_event_id);

      select coalesce(stats_row.packs_opened, 0),
             coalesce(stats_row.total_cards_pulled, 0)
        into v_packs_opened, v_total_cards_pulled
      from public.user_profile_stats as stats_row
      where stats_row.user_id = v_user_id;

      return query select
        v_event_id, v_set_id, null::text, null::integer, false, v_reason,
        false, coalesce(v_packs_opened, 0), coalesce(v_total_cards_pulled, 0);
      return;
    end if;
  end if;

  v_now := clock_timestamp();

  if not v_pack_event_exists then
    insert into public.user_pack_open_events(
      user_id,
      client_event_id,
      set_id,
      opened_at,
      created_at
    ) values (v_user_id, v_event_id, v_set_id, v_now, v_now);
  end if;

  if not v_collection_exists then
    insert into public.user_collection_increment_events(
      user_id,
      client_event_id,
      cards_added
    ) values (v_user_id, v_event_id, v_total_quantity);

    with grouped_cards as (
      select trim(payload_card.value ->> 'set_id') as grouped_set_id,
             trim(payload_card.value ->> 'card_id') as grouped_card_id,
             sum((payload_card.value ->> 'quantity')::integer)::integer as grouped_quantity
      from jsonb_array_elements(v_cards) as payload_card(value)
      group by trim(payload_card.value ->> 'set_id'), trim(payload_card.value ->> 'card_id')
    ), new_cards as (
      select grouped.grouped_set_id,
             grouped.grouped_card_id,
             grouped.grouped_quantity,
             (stored.card_id is null) as is_new
      from grouped_cards as grouped
      left join public.user_collection as stored
        on stored.user_id = v_user_id
       and stored.set_id = grouped.grouped_set_id
       and stored.card_id = grouped.grouped_card_id
    ), applied_cards as (
      insert into public.user_collection as target(user_id, set_id, card_id, quantity)
      select v_user_id,
             new_card.grouped_set_id,
             new_card.grouped_card_id,
             new_card.grouped_quantity
      from new_cards as new_card
      on conflict on constraint user_collection_user_id_set_id_card_id_key do update
        set quantity = target.quantity + excluded.quantity,
            updated_at = v_now
      returning target.card_id
    )
    select count(*) filter (where new_card.is_new)::integer
      into v_new_card_count
    from new_cards as new_card;
  end if;

  if not v_pack_event_exists or not v_collection_exists then
    insert into public.user_profile_stats as stats_row(
      user_id,
      packs_opened,
      total_cards_pulled,
      unique_cards
    ) values (
      v_user_id,
      case when v_pack_event_exists then 0 else 1 end,
      case when v_collection_exists then 0 else v_total_quantity end,
      case when v_collection_exists then 0 else v_new_card_count end
    )
    on conflict (user_id) do update
      set packs_opened = stats_row.packs_opened + excluded.packs_opened,
          total_cards_pulled = stats_row.total_cards_pulled + excluded.total_cards_pulled,
          unique_cards = stats_row.unique_cards + excluded.unique_cards,
          updated_at = v_now;
  end if;

  select coalesce(stats_row.packs_opened, 0),
         coalesce(stats_row.total_cards_pulled, 0)
    into v_packs_opened, v_total_cards_pulled
  from public.user_profile_stats as stats_row
  where stats_row.user_id = v_user_id;

  return query
    select v_event_id,
           stored.set_id,
           stored.card_id,
           stored.quantity,
           true,
           null::text,
           not v_pack_event_exists,
           coalesce(v_packs_opened, 0),
           coalesce(v_total_cards_pulled, 0)
    from public.user_collection as stored
    join (
      select distinct trim(payload_card.value ->> 'set_id') as submitted_set_id,
             trim(payload_card.value ->> 'card_id') as submitted_card_id
      from jsonb_array_elements(v_cards) as payload_card(value)
    ) as submitted
      on stored.set_id = submitted.submitted_set_id
     and stored.card_id = submitted.submitted_card_id
    where stored.user_id = v_user_id;
end;
$$;

revoke all on function public.increment_collection_cards(jsonb) from public, anon;
grant execute on function public.increment_collection_cards(jsonb) to authenticated;

-- Normal clients must not be able to bypass the atomic write with the legacy
-- event-only RPC. Service workflows retain access for administrative recovery.
revoke execute on function public.record_pack_open_event(text, text, timestamptz) from authenticated;
grant execute on function public.record_pack_open_event(text, text, timestamptz) to service_role;
