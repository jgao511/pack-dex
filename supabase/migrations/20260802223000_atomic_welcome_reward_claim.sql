-- Make the one-time welcome reward use the same serialized, additive mutation
-- boundary as normal packs, scanner additions, and mobile onboarding.
--
-- This is an expand-first migration: the existing Edge Function remains
-- compatible until the new function is deployed. Historical completed rewards
-- are not backfilled or otherwise changed.
begin;

alter table public.user_welcome_rewards
  add column if not exists welcome_reward_collection_event_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_welcome_rewards_collection_event_id_format'
      and conrelid = 'public.user_welcome_rewards'::regclass
  ) then
    alter table public.user_welcome_rewards
      add constraint user_welcome_rewards_collection_event_id_format
      check (
        welcome_reward_collection_event_id is null
        or (
          length(trim(welcome_reward_collection_event_id)) between 1 and 160
          and welcome_reward_collection_event_id like 'welcome-god-pack:%'
        )
      ) not valid;
  end if;
end;
$$;

alter table public.user_welcome_rewards
  validate constraint user_welcome_rewards_collection_event_id_format;

create or replace function public.increment_packdex_public_welcome_cards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reward_card_count integer := 0;
begin
  -- New atomic claims insert an idempotency receipt. That receipt already
  -- increments the public card total, so the saved-marker trigger must not add
  -- the same cards again. Old Edge versions leave this marker null and retain
  -- the historical trigger behavior during the compatible deployment window.
  if new.welcome_reward_collection_event_id is not null
     and exists (
       select 1
       from public.user_collection_increment_events as receipt
       where receipt.user_id = new.user_id
         and receipt.client_event_id = new.welcome_reward_collection_event_id
     ) then
    return new;
  end if;

  if jsonb_typeof(new.welcome_reward_cards) = 'array' then
    v_reward_card_count := jsonb_array_length(new.welcome_reward_cards);
  end if;

  if v_reward_card_count > 0 then
    insert into public.packdex_public_stats as stats(
      singleton,
      cards_pulled,
      packs_opened,
      updated_at
    )
    values (true, v_reward_card_count, 0, now())
    on conflict (singleton) do update
      set cards_pulled = stats.cards_pulled + excluded.cards_pulled,
          updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.increment_packdex_public_welcome_cards()
  from public, anon, authenticated;

create or replace function public.claim_welcome_god_pack_v1(
  p_user_id uuid,
  p_set_id text,
  p_claim_id uuid,
  p_reward_cards jsonb
)
returns table(
  status text,
  client_event_id text,
  recorded boolean,
  already_processed boolean,
  eligible_packs integer,
  reward_set_id text,
  reward_claim_id text,
  reward_claimed_at timestamptz,
  packs_opened integer,
  total_cards_pulled integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_set_id text := trim(coalesce(p_set_id, ''));
  v_claim_id text := coalesce(p_claim_id::text, '');
  v_event_id text := 'welcome-god-pack:' || coalesce(p_claim_id::text, '');
  v_eligible_packs integer := 0;
  v_existing_claimed boolean := false;
  v_existing_saved_at timestamptz;
  v_existing_set_id text;
  v_existing_claim_id text;
  v_existing_event_id text;
  v_existing_claimed_at timestamptz;
  v_claimed_at timestamptz;
  v_new_card_count integer := 0;
  v_updated_count integer := 0;
  v_packs_opened integer := 0;
  v_total_cards_pulled integer := 0;
begin
  if p_user_id is null
     or p_claim_id is null
     or not exists (select 1 from auth.users as account where account.id = p_user_id)
     or v_set_id not in (
       'prismatic-evolutions',
       'black-bolt',
       'white-flare',
       'ascended-heroes',
       '151'
     )
     or jsonb_typeof(p_reward_cards) is distinct from 'array'
     or jsonb_array_length(p_reward_cards) <> 10
     or exists (
       select 1
       from jsonb_array_elements(p_reward_cards) as card(value)
       where jsonb_typeof(card.value) <> 'object'
          or length(trim(coalesce(card.value ->> 'id', ''))) not between 1 and 200
          or trim(coalesce(card.value ->> 'setId', '')) <> v_set_id
     ) then
    raise exception 'Invalid welcome reward payload' using errcode = '22023';
  end if;

  -- This exact lock key is shared by every supported collection mutation.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*)::integer
    into v_eligible_packs
  from public.user_pack_open_events as eligible_event
  where eligible_event.user_id = p_user_id
    and eligible_event.client_event_id not like 'welcome-god-pack:%';

  if v_eligible_packs < 50 then
    select coalesce(profile.packs_opened, 0),
           coalesce(profile.total_cards_pulled, 0)
      into v_packs_opened, v_total_cards_pulled
    from (select 1) as seed
    left join public.user_profile_stats as profile on profile.user_id = p_user_id;

    return query select
      'not_ready'::text,
      v_event_id,
      false,
      false,
      v_eligible_packs,
      v_set_id,
      v_claim_id,
      null::timestamptz,
      coalesce(v_packs_opened, 0),
      coalesce(v_total_cards_pulled, 0);
    return;
  end if;

  insert into public.user_welcome_rewards(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select reward.welcome_god_pack_claimed,
         reward.welcome_reward_cards_saved_at,
         reward.welcome_god_pack_set,
         reward.welcome_reward_claim_id,
         reward.welcome_reward_collection_event_id,
         reward.welcome_reward_claimed_at
    into v_existing_claimed,
         v_existing_saved_at,
         v_existing_set_id,
         v_existing_claim_id,
         v_existing_event_id,
         v_existing_claimed_at
  from public.user_welcome_rewards as reward
  where reward.user_id = p_user_id
  for update;

  select coalesce(profile.packs_opened, 0),
         coalesce(profile.total_cards_pulled, 0)
    into v_packs_opened, v_total_cards_pulled
  from (select 1) as seed
  left join public.user_profile_stats as profile on profile.user_id = p_user_id;

  if v_existing_claimed and v_existing_saved_at is not null then
    return query select
      'already_claimed'::text,
      coalesce(v_existing_event_id, 'welcome-god-pack:' || coalesce(v_existing_claim_id, '')),
      false,
      true,
      v_eligible_packs,
      coalesce(v_existing_set_id, ''),
      coalesce(v_existing_claim_id, ''),
      v_existing_claimed_at,
      coalesce(v_packs_opened, 0),
      coalesce(v_total_cards_pulled, 0);
    return;
  end if;

  -- The old multi-statement path did not leave enough evidence to determine
  -- whether a claimed-but-unsaved row applied zero, some, or all mutations.
  -- Preserve it for diagnosis instead of risking a blind duplicate grant.
  if v_existing_claimed then
    return query select
      'legacy_pending_review'::text,
      coalesce(v_existing_event_id, 'welcome-god-pack:' || coalesce(v_existing_claim_id, '')),
      false,
      false,
      v_eligible_packs,
      coalesce(v_existing_set_id, ''),
      coalesce(v_existing_claim_id, ''),
      v_existing_claimed_at,
      coalesce(v_packs_opened, 0),
      coalesce(v_total_cards_pulled, 0);
    return;
  end if;

  v_claimed_at := clock_timestamp();

  update public.user_welcome_rewards as reward
  set welcome_god_pack_claimed = true,
      welcome_god_pack_set = v_set_id,
      welcome_reward_claimed_at = v_claimed_at,
      welcome_reward_claim_id = v_claim_id,
      welcome_reward_cards = p_reward_cards
  where reward.user_id = p_user_id
    and reward.welcome_god_pack_claimed = false;
  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception 'Welcome reward claim changed concurrently' using errcode = '40001';
  end if;

  insert into public.user_collection_increment_events(
    user_id,
    client_event_id,
    cards_added
  ) values (
    p_user_id,
    v_event_id,
    10
  );

  with grouped_cards as (
    select
      trim(card.value ->> 'id') as grouped_card_id,
      count(*)::integer as grouped_quantity
    from jsonb_array_elements(p_reward_cards) as card(value)
    group by trim(card.value ->> 'id')
  ), incoming_cards as (
    select
      grouped.grouped_card_id,
      grouped.grouped_quantity,
      stored.card_id is null as is_new
    from grouped_cards as grouped
    left join public.user_collection as stored
      on stored.user_id = p_user_id
     and stored.set_id = v_set_id
     and stored.card_id = grouped.grouped_card_id
  ), applied_cards as (
    insert into public.user_collection as target(
      user_id,
      set_id,
      card_id,
      quantity
    )
    select
      p_user_id,
      v_set_id,
      incoming.grouped_card_id,
      incoming.grouped_quantity
    from incoming_cards as incoming
    on conflict on constraint user_collection_user_id_set_id_card_id_key do update
      set quantity = target.quantity + excluded.quantity,
          updated_at = v_claimed_at
    returning target.card_id
  )
  select count(*) filter (where incoming.is_new)::integer
    into v_new_card_count
  from incoming_cards as incoming;

  insert into public.user_pack_open_events(
    user_id,
    client_event_id,
    set_id,
    opened_at,
    created_at
  ) values (
    p_user_id,
    v_event_id,
    v_set_id,
    v_claimed_at,
    v_claimed_at
  );

  insert into public.user_profile_stats as profile(
    user_id,
    packs_opened,
    total_cards_pulled,
    unique_cards
  ) values (
    p_user_id,
    1,
    10,
    v_new_card_count
  )
  on conflict (user_id) do update
    set packs_opened = profile.packs_opened + excluded.packs_opened,
        total_cards_pulled = profile.total_cards_pulled + excluded.total_cards_pulled,
        unique_cards = profile.unique_cards + excluded.unique_cards,
        updated_at = v_claimed_at;

  update public.user_welcome_rewards as reward
  set welcome_reward_cards_saved_at = v_claimed_at,
      welcome_reward_collection_event_id = v_event_id
  where reward.user_id = p_user_id
    and reward.welcome_reward_cards_saved_at is null;

  select coalesce(profile.packs_opened, 0),
         coalesce(profile.total_cards_pulled, 0)
    into v_packs_opened, v_total_cards_pulled
  from public.user_profile_stats as profile
  where profile.user_id = p_user_id;

  return query select
    'claimed'::text,
    v_event_id,
    true,
    false,
    v_eligible_packs,
    v_set_id,
    v_claim_id,
    v_claimed_at,
    coalesce(v_packs_opened, 0),
    coalesce(v_total_cards_pulled, 0);
end;
$$;

revoke all on function public.claim_welcome_god_pack_v1(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_welcome_god_pack_v1(uuid, text, uuid, jsonb)
  to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.claim_welcome_god_pack_v1(uuid,text,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_welcome_god_pack_v1(uuid,text,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_welcome_god_pack_v1(uuid,text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Atomic welcome reward function privileges are unsafe';
  end if;
end;
$$;

commit;
