-- Expand/migrate phase for the completed-pack integrity incident.
--
-- Deployment order:
--   1. Apply this compatible server contract.
--   2. Deploy contract-v4 desktop/mobile clients and service worker.
--   3. Confirm legacy usage has stopped and preserved queues have drained.
--   4. Remove the narrow legacy bridge in a later migration, no earlier than
--      2026-09-02 and only after production evidence shows zero callers.

create table if not exists public.user_pack_legacy_compat_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_hash text not null,
  set_id text not null default '',
  outcome text not null,
  first_used_at timestamptz not null default clock_timestamp(),
  primary key (user_id, client_event_hash),
  constraint user_pack_legacy_compat_events_outcome_check
    check (outcome in ('already_processed', 'repaired_missing_pack_event'))
);

alter table public.user_pack_legacy_compat_events enable row level security;
revoke all on public.user_pack_legacy_compat_events from public, anon, authenticated;
grant select, insert on public.user_pack_legacy_compat_events to service_role;

-- The v3 wrapper is replaced transactionally. Existing clients keep every old
-- response field; v4 clients additionally require already_processed,
-- rejection_code, and retryable before they change local queue state.
drop function public.increment_collection_cards(jsonb);

create function public.increment_collection_cards(batches jsonb)
returns table(
  client_event_id text,
  set_id text,
  card_id text,
  quantity integer,
  accepted boolean,
  rejection_reason text,
  recorded boolean,
  already_processed boolean,
  rejection_code text,
  retryable boolean,
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
  v_collection_exists boolean := false;
  v_pack_event_exists boolean := false;
  v_packs_opened integer := 0;
  v_total_cards_pulled integer := 0;
  v_rejection_code text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(stats_row.packs_opened, 0),
         coalesce(stats_row.total_cards_pulled, 0)
    into v_packs_opened, v_total_cards_pulled
  from public.user_profile_stats as stats_row
  where stats_row.user_id = v_user_id;

  if coalesce(jsonb_typeof(batches), 'null') <> 'array'
     or jsonb_array_length(batches) <> 1 then
    v_rejection_code := 'invalid_completed_pack_count';
  else
    v_batch := batches -> 0;
    v_event_id := trim(coalesce(v_batch ->> 'client_event_id', ''));
    v_cards := v_batch -> 'cards';

    if coalesce(jsonb_typeof(v_batch), 'null') <> 'object'
       or length(v_event_id) not between 1 and 160
       or coalesce(jsonb_typeof(v_cards), 'null') <> 'array'
       or jsonb_array_length(v_cards) not between 1 and 100 then
      v_rejection_code := 'invalid_completed_pack_payload';
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
      v_rejection_code := 'invalid_collection_card_payload';
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
        v_rejection_code := 'completed_pack_crosses_sets';
      end if;
    end if;
  end if;

  if v_rejection_code is not null then
    return query select
      nullif(v_event_id, ''), nullif(v_set_id, ''), null::text, null::integer,
      false, v_rejection_code, false, false, v_rejection_code, false,
      coalesce(v_packs_opened, 0), coalesce(v_total_cards_pulled, 0);
    return;
  end if;

  -- Share the internal transaction lock so the acknowledgement describes the
  -- exact state the internal atomic mutation observed.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select exists (
    select 1 from public.user_collection_increment_events as receipt
    where receipt.user_id = v_user_id
      and receipt.client_event_id = v_event_id
  ) into v_collection_exists;

  select exists (
    select 1 from public.user_pack_open_events as pack_event
    where pack_event.user_id = v_user_id
      and pack_event.client_event_id = v_event_id
  ) into v_pack_event_exists;

  return query
    select
      internal.client_event_id,
      internal.set_id,
      internal.card_id,
      internal.quantity,
      internal.accepted,
      internal.rejection_reason,
      case
        when internal.accepted then not (v_collection_exists and v_pack_event_exists)
        else false
      end as recorded,
      case
        when internal.accepted then v_collection_exists and v_pack_event_exists
        else false
      end as already_processed,
      internal.rejection_reason as rejection_code,
      case
        when not internal.accepted
          and internal.rejection_reason in ('pack_rate_limit_one_second', 'pack_rate_limit_sixty_seconds')
          then true
        else false
      end as retryable,
      internal.packs_opened,
      internal.total_cards_pulled
    from public.increment_collection_cards_v2_internal(batches) as internal;
end;
$$;

revoke all on function public.increment_collection_cards(jsonb)
  from public, anon, service_role;
grant execute on function public.increment_collection_cards(jsonb)
  to authenticated;

-- Temporary compatibility bridge. A legacy call can only repair the pack-event
-- half when the authenticated user already owns the matching durable collection
-- receipt. It cannot write collection rows and it never accepts an arbitrary
-- event without server evidence of the collection half.
create or replace function public.record_pack_open_event(
  p_client_event_id text,
  p_set_id text default '',
  p_opened_at timestamptz default now()
)
returns table(recorded boolean, packs_opened integer, total_cards_pulled integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id text := trim(coalesce(p_client_event_id, ''));
  v_set_id text := left(trim(coalesce(p_set_id, '')), 120);
  v_inserted boolean := false;
  v_inserted_count integer := 0;
  v_receipt_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(v_event_id) not between 1 and 160
     or length(v_set_id) not between 1 and 120 then
    raise exception 'Invalid legacy pack event payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select receipt.created_at
    into v_receipt_created_at
  from public.user_collection_increment_events as receipt
  where receipt.user_id = v_user_id
    and receipt.client_event_id = v_event_id;

  if v_receipt_created_at is null then
    raise exception 'Legacy event cannot be repaired without its collection receipt'
      using errcode = 'P0001', hint = 'Use increment_collection_cards with the original completed-pack payload.';
  end if;

  -- This is a repair of a previously accepted collection receipt, not a new
  -- opening. Use the server receipt timestamp; never trust a legacy client to
  -- backdate or manufacture activity through p_opened_at.
  insert into public.user_pack_open_events(user_id, client_event_id, set_id, opened_at, created_at)
  values (v_user_id, v_event_id, v_set_id, v_receipt_created_at, v_receipt_created_at)
  on conflict (user_id, client_event_id) do nothing;
  get diagnostics v_inserted_count = row_count;
  v_inserted := v_inserted_count > 0;

  if v_inserted then
    insert into public.user_profile_stats as stats(user_id, packs_opened)
    values (v_user_id, 1)
    on conflict (user_id) do update
      set packs_opened = stats.packs_opened + 1,
          updated_at = clock_timestamp();
  end if;

  insert into public.user_pack_legacy_compat_events(
    user_id, client_event_hash, set_id, outcome
  ) values (
    v_user_id,
    md5(v_event_id),
    v_set_id,
    case when v_inserted then 'repaired_missing_pack_event' else 'already_processed' end
  ) on conflict (user_id, client_event_hash) do nothing;

  return query select
    v_inserted,
    coalesce((select stats.packs_opened from public.user_profile_stats as stats where stats.user_id = v_user_id), 0),
    coalesce((select stats.total_cards_pulled from public.user_profile_stats as stats where stats.user_id = v_user_id), 0);
end;
$$;

revoke all on function public.record_pack_open_event(text, text, timestamptz)
  from public, anon;
grant execute on function public.record_pack_open_event(text, text, timestamptz)
  to authenticated, service_role;
