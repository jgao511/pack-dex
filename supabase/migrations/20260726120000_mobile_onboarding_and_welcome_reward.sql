begin;

create table if not exists public.user_mobile_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  tutorial_set_id text,
  tutorial_client_event_id text,
  skipped boolean not null default false,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_mobile_onboarding enable row level security;
revoke all on table public.user_mobile_onboarding from public, anon;
grant select on table public.user_mobile_onboarding to authenticated;
grant all on table public.user_mobile_onboarding to service_role;

drop policy if exists "Users can read their mobile onboarding" on public.user_mobile_onboarding;
create policy "Users can read their mobile onboarding"
on public.user_mobile_onboarding for select to authenticated
using (auth.uid() = user_id);

create table if not exists public.packdex_weekly_set_stats (
  week_start date not null,
  set_id text not null,
  packs_opened bigint not null default 0 check (packs_opened >= 0),
  updated_at timestamptz not null default now(),
  primary key (week_start, set_id)
);

alter table public.packdex_weekly_set_stats enable row level security;
revoke all on table public.packdex_weekly_set_stats from public, anon, authenticated;
grant all on table public.packdex_weekly_set_stats to service_role;

create or replace function public.increment_packdex_weekly_set_stats()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_week date := date_trunc('week', coalesce(new.opened_at, new.created_at, now()))::date;
begin
  if coalesce(trim(new.set_id), '') <> '' then
    insert into public.packdex_weekly_set_stats as stats(week_start, set_id, packs_opened, updated_at)
    values (event_week, trim(new.set_id), 1, now())
    on conflict (week_start, set_id) do update
      set packs_opened = stats.packs_opened + 1,
          updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.increment_packdex_weekly_set_stats() from public, anon, authenticated;
drop trigger if exists increment_packdex_weekly_set_stats on public.user_pack_open_events;
create trigger increment_packdex_weekly_set_stats
after insert on public.user_pack_open_events
for each row execute function public.increment_packdex_weekly_set_stats();

insert into public.packdex_weekly_set_stats(week_start, set_id, packs_opened, updated_at)
select date_trunc('week', coalesce(opened_at, created_at))::date, set_id, count(*)::bigint, now()
from public.user_pack_open_events
where coalesce(trim(set_id), '') <> ''
group by 1, 2
on conflict (week_start, set_id) do update
set packs_opened = excluded.packs_opened,
    updated_at = now();

drop function if exists public.get_public_packdex_stats();
create or replace function public.get_public_packdex_stats()
returns table(
  cards_pulled bigint,
  packs_opened bigint,
  popular_set_id text,
  popular_set_week_start date,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    totals.cards_pulled,
    totals.packs_opened,
    weekly.set_id,
    weekly.week_start,
    greatest(totals.updated_at, coalesce(weekly.updated_at, totals.updated_at))
  from public.packdex_public_stats as totals
  left join lateral (
    select stats.set_id, stats.week_start, stats.updated_at
    from public.packdex_weekly_set_stats as stats
    where stats.week_start = date_trunc('week', now())::date
    order by stats.packs_opened desc, stats.set_id
    limit 1
  ) as weekly on true
  where totals.singleton = true
  limit 1;
$$;

revoke all on function public.get_public_packdex_stats() from public;
grant execute on function public.get_public_packdex_stats() to anon, authenticated;

create or replace function public.complete_mobile_onboarding_v1(
  p_user_id uuid,
  p_version integer,
  p_set_id text,
  p_card_ids text[],
  p_skipped boolean
)
returns table(completed boolean, already_completed boolean, packs_opened integer, total_cards_pulled integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_user uuid;
  event_id text := 'mobile-onboarding:v' || p_version::text;
  card_id text;
  card_counts jsonb;
begin
  if p_user_id is null or p_version <> 1 then
    raise exception 'Invalid onboarding request' using errcode = '22023';
  end if;
  if not p_skipped and (
    coalesce(trim(p_set_id), '') = ''
    or coalesce(array_length(p_card_ids, 1), 0) <> 10
  ) then
    raise exception 'Invalid tutorial pack' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':mobile-onboarding', 0));

  insert into public.user_mobile_onboarding(user_id, version, tutorial_set_id, tutorial_client_event_id, skipped)
  values (p_user_id, p_version, nullif(trim(p_set_id), ''), case when p_skipped then null else event_id end, p_skipped)
  on conflict (user_id) do update
    set version = excluded.version,
        tutorial_set_id = excluded.tutorial_set_id,
        tutorial_client_event_id = excluded.tutorial_client_event_id,
        skipped = excluded.skipped,
        completed_at = now(),
        updated_at = now()
    where public.user_mobile_onboarding.version < excluded.version
  returning user_id into inserted_user;

  if inserted_user is null then
    return query
      select false, true, coalesce(s.packs_opened, 0), coalesce(s.total_cards_pulled, 0)
      from (select 1) seed
      left join public.user_profile_stats s on s.user_id = p_user_id;
    return;
  end if;

  if not p_skipped then
    select jsonb_object_agg(grouped.card_id, grouped.quantity)
    into card_counts
    from (
      select value as card_id, count(*)::integer as quantity
      from unnest(p_card_ids) as value
      where coalesce(trim(value), '') <> ''
      group by value
    ) grouped;

    for card_id in select jsonb_object_keys(card_counts)
    loop
      insert into public.user_collection(user_id, set_id, card_id, quantity)
      values (p_user_id, p_set_id, card_id, (card_counts ->> card_id)::integer)
      on conflict (user_id, set_id, card_id) do update
      set quantity = public.user_collection.quantity + excluded.quantity,
          updated_at = now();
    end loop;

    insert into public.user_pack_open_events(user_id, client_event_id, set_id, opened_at)
    values (p_user_id, event_id, p_set_id, now())
    on conflict (user_id, client_event_id) do nothing;

    insert into public.user_profile_stats as stats(user_id, packs_opened, total_cards_pulled, unique_cards)
    values (p_user_id, 1, array_length(p_card_ids, 1), jsonb_object_length(card_counts))
    on conflict (user_id) do update
    set packs_opened = greatest(stats.packs_opened + 1, (
          select count(*)::integer from public.user_pack_open_events where user_id = p_user_id
        )),
        total_cards_pulled = stats.total_cards_pulled + excluded.total_cards_pulled,
        unique_cards = stats.unique_cards + (
          select count(*)::integer
          from jsonb_object_keys(card_counts) incoming(card_id)
          where not exists (
            select 1 from public.user_collection existing
            where existing.user_id = p_user_id and existing.set_id = p_set_id
              and existing.card_id = incoming.card_id
              and existing.quantity > (card_counts ->> incoming.card_id)::integer
          )
        ),
        updated_at = now();

    insert into public.packdex_public_stats as public_stats(singleton, cards_pulled, packs_opened, updated_at)
    values (true, array_length(p_card_ids, 1), 0, now())
    on conflict (singleton) do update
    set cards_pulled = public_stats.cards_pulled + excluded.cards_pulled,
        updated_at = now();
  end if;

  return query
    select true, false, coalesce(s.packs_opened, 0), coalesce(s.total_cards_pulled, 0)
    from (select 1) seed
    left join public.user_profile_stats s on s.user_id = p_user_id;
end;
$$;

revoke all on function public.complete_mobile_onboarding_v1(uuid, integer, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.complete_mobile_onboarding_v1(uuid, integer, text, text[], boolean) to service_role;

commit;
