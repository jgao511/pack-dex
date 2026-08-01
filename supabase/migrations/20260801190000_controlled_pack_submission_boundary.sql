-- Keep the strict one-pack contract while turning predictable stale-client
-- shape failures into controlled, non-writing results. The previously deployed
-- atomic transaction remains the only implementation of collection/event/stats
-- writes and is no longer directly application-accessible.

alter function public.increment_collection_cards(jsonb)
  rename to increment_collection_cards_v2_internal;

alter function public.increment_collection_cards_v2_internal(jsonb)
  set search_path = public, pg_temp;
revoke all on function public.increment_collection_cards_v2_internal(jsonb)
  from public, anon, authenticated, service_role;

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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch jsonb;
  v_event_id text := '';
  v_cards jsonb;
  v_set_id text := '';
  v_packs_opened integer := 0;
  v_total_cards_pulled integer := 0;
  v_rejection_reason text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(stats_row.packs_opened, 0),
         coalesce(stats_row.total_cards_pulled, 0)
    into v_packs_opened, v_total_cards_pulled
  from public.user_profile_stats as stats_row
  where stats_row.user_id = v_user_id;

  if coalesce(jsonb_typeof(batches), 'null') <> 'array' then
    v_rejection_reason := 'invalid_completed_pack_count';
  elsif jsonb_array_length(batches) <> 1 then
    v_rejection_reason := 'invalid_completed_pack_count';
  else
    v_batch := batches -> 0;
    v_event_id := trim(coalesce(v_batch ->> 'client_event_id', ''));
    v_cards := v_batch -> 'cards';

    if coalesce(jsonb_typeof(v_batch), 'null') <> 'object'
       or length(v_event_id) not between 1 and 160
       or coalesce(jsonb_typeof(v_cards), 'null') <> 'array' then
      v_rejection_reason := 'invalid_completed_pack_payload';
    elsif jsonb_array_length(v_cards) not between 1 and 100 then
      v_rejection_reason := 'invalid_completed_pack_payload';
    elsif exists (
      select 1
      from jsonb_array_elements(v_cards) as payload_card(value)
      where jsonb_typeof(payload_card.value) <> 'object'
         or length(trim(coalesce(payload_card.value ->> 'set_id', ''))) not between 1 and 120
         or length(trim(coalesce(payload_card.value ->> 'card_id', ''))) not between 1 and 200
         or case
              when jsonb_typeof(payload_card.value -> 'quantity') = 'number' then
                (payload_card.value ->> 'quantity')::numeric not between 1 and 100
                or trunc((payload_card.value ->> 'quantity')::numeric) <> (payload_card.value ->> 'quantity')::numeric
              else true
            end
    ) then
      v_rejection_reason := 'invalid_collection_card_payload';
    else
      select trim(payload_card.value ->> 'set_id')
        into v_set_id
      from jsonb_array_elements(v_cards) as payload_card(value)
      limit 1;

      if exists (
        select 1
        from jsonb_array_elements(v_cards) as payload_card(value)
        where trim(payload_card.value ->> 'set_id') <> v_set_id
      ) then
        v_rejection_reason := 'completed_pack_crosses_sets';
      end if;
    end if;
  end if;

  if v_rejection_reason is not null then
    return query select
      nullif(v_event_id, ''),
      nullif(v_set_id, ''),
      null::text,
      null::integer,
      false,
      v_rejection_reason,
      false,
      coalesce(v_packs_opened, 0),
      coalesce(v_total_cards_pulled, 0);
    return;
  end if;

  return query
    select *
    from public.increment_collection_cards_v2_internal(batches);
end;
$$;

revoke all on function public.increment_collection_cards(jsonb)
  from public, anon, service_role;
grant execute on function public.increment_collection_cards(jsonb)
  to authenticated;

-- The event-only path stays unavailable to normal clients. Its name is retained
-- only because old migrations and trusted recovery tooling may still reference it.
revoke all on function public.record_pack_open_event(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_pack_open_event(text, text, timestamptz)
  to service_role;
