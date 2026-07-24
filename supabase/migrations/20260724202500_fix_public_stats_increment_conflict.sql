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
      on conflict (user_id, set_id, card_id) do update
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
