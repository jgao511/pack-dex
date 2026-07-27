begin;

alter table public.user_mobile_onboarding
  add column if not exists completion_id text;

update public.user_mobile_onboarding
set completion_id = 'mobile-onboarding:v' || version::text
where completion_id is null;

alter table public.user_mobile_onboarding
  alter column completion_id set not null;

drop function if exists public.complete_mobile_onboarding_v1(uuid, integer, text, text[], boolean);

create function public.complete_mobile_onboarding_v1(
  p_user_id uuid,
  p_version integer,
  p_set_id text,
  p_card_ids text[],
  p_skipped boolean
)
returns table(
  completed boolean,
  already_completed boolean,
  tutorial_pack_saved boolean,
  packs_opened integer,
  total_cards_pulled integer,
  reward_progress integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted_user uuid;
  v_collection_receipt text;
  v_pack_event text;
  v_event_id text := 'mobile-onboarding:v' || p_version::text;
  v_completion_id text := 'mobile-onboarding:v' || p_version::text;
  v_total_cards integer := coalesce(array_length(p_card_ids, 1), 0);
  v_new_card_count integer := 0;
begin
  if p_user_id is null or p_version <> 1 then
    raise exception 'Invalid onboarding request' using errcode = '22023';
  end if;
  if not p_skipped and (
    coalesce(trim(p_set_id), '') = ''
    or v_total_cards <> 10
  ) then
    raise exception 'Invalid tutorial pack' using errcode = '22023';
  end if;

  -- This is the same per-user lock used by collection batching. It serializes
  -- concurrent callback reloads and collection writes through the grant.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  insert into public.user_mobile_onboarding(
    user_id,
    version,
    completion_id,
    tutorial_set_id,
    tutorial_client_event_id,
    skipped
  )
  values (
    p_user_id,
    p_version,
    v_completion_id,
    nullif(trim(p_set_id), ''),
    case when p_skipped then null else v_event_id end,
    p_skipped
  )
  on conflict (user_id) do update
    set version = excluded.version,
        completion_id = excluded.completion_id,
        tutorial_set_id = excluded.tutorial_set_id,
        tutorial_client_event_id = excluded.tutorial_client_event_id,
        skipped = excluded.skipped,
        completed_at = now(),
        updated_at = now()
    where public.user_mobile_onboarding.version < excluded.version
  returning user_id into v_inserted_user;

  if v_inserted_user is null then
    return query
      select
        false,
        true,
        (
          not existing.skipped
          and exists (
            select 1
            from public.user_collection_increment_events as receipt
            where receipt.user_id = p_user_id
              and receipt.client_event_id = existing.tutorial_client_event_id
          )
          and exists (
            select 1
            from public.user_pack_open_events as pack_event
            where pack_event.user_id = p_user_id
              and pack_event.client_event_id = existing.tutorial_client_event_id
          )
        ),
        coalesce(profile.packs_opened, 0),
        coalesce(profile.total_cards_pulled, 0),
        (
          select count(*)::integer
          from public.user_pack_open_events as eligible_event
          where eligible_event.user_id = p_user_id
            and eligible_event.client_event_id not like 'welcome-god-pack:%'
        )
      from public.user_mobile_onboarding as existing
      left join public.user_profile_stats as profile on profile.user_id = p_user_id
      where existing.user_id = p_user_id;
    return;
  end if;

  if not p_skipped then
    insert into public.user_collection_increment_events as receipt(
      user_id,
      client_event_id,
      cards_added
    )
    values (p_user_id, v_event_id, v_total_cards)
    on conflict on constraint user_collection_increment_events_pkey do nothing
    returning receipt.client_event_id into v_collection_receipt;

    if v_collection_receipt is not null then
      with grouped_cards as (
        select
          trim(card_value) as grouped_card_id,
          count(*)::integer as grouped_quantity
        from unnest(p_card_ids) as card_value
        where coalesce(trim(card_value), '') <> ''
        group by trim(card_value)
      ), incoming_cards as (
        select
          grouped.grouped_card_id,
          grouped.grouped_quantity,
          stored.card_id is null as is_new
        from grouped_cards as grouped
        left join public.user_collection as stored
          on stored.user_id = p_user_id
         and stored.set_id = trim(p_set_id)
         and stored.card_id = grouped.grouped_card_id
      ), applied_cards as (
        insert into public.user_collection as target(user_id, set_id, card_id, quantity)
        select
          p_user_id,
          trim(p_set_id),
          incoming.grouped_card_id,
          incoming.grouped_quantity
        from incoming_cards as incoming
        on conflict on constraint user_collection_user_id_set_id_card_id_key do update
          set quantity = target.quantity + excluded.quantity,
              updated_at = now()
        returning target.card_id
      )
      select count(*) filter (where incoming.is_new)::integer
      into v_new_card_count
      from incoming_cards as incoming;

      insert into public.user_profile_stats as profile(user_id, total_cards_pulled, unique_cards)
      values (p_user_id, v_total_cards, v_new_card_count)
      on conflict (user_id) do update
        set total_cards_pulled = profile.total_cards_pulled + excluded.total_cards_pulled,
            unique_cards = profile.unique_cards + excluded.unique_cards,
            updated_at = now();
    end if;

    insert into public.user_pack_open_events as pack_event(
      user_id,
      client_event_id,
      set_id,
      opened_at
    )
    values (p_user_id, v_event_id, trim(p_set_id), now())
    on conflict (user_id, client_event_id) do nothing
    returning pack_event.client_event_id into v_pack_event;

    if v_pack_event is not null then
      insert into public.user_profile_stats as profile(user_id, packs_opened)
      values (p_user_id, 1)
      on conflict (user_id) do update
        set packs_opened = profile.packs_opened + 1,
            updated_at = now();
    end if;
  end if;

  return query
    select
      true,
      false,
      (
        not p_skipped
        and v_collection_receipt is not null
        and exists (
          select 1
          from public.user_pack_open_events as saved_event
          where saved_event.user_id = p_user_id
            and saved_event.client_event_id = v_event_id
        )
      ),
      coalesce(profile.packs_opened, 0),
      coalesce(profile.total_cards_pulled, 0),
      (
        select count(*)::integer
        from public.user_pack_open_events as eligible_event
        where eligible_event.user_id = p_user_id
          and eligible_event.client_event_id not like 'welcome-god-pack:%'
      )
    from (select 1) as seed
    left join public.user_profile_stats as profile on profile.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_mobile_onboarding_v1(uuid, integer, text, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.complete_mobile_onboarding_v1(uuid, integer, text, text[], boolean)
  to service_role;

commit;
