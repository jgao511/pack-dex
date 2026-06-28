-- Low-risk, server-recorded pack-open events for basic engagement stats.
-- These events are not authoritative for card-specific, rarity, value, chase,
-- binder, or competitive achievements.

create table if not exists public.user_pack_open_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  set_id text not null default '',
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, client_event_id)
);

alter table public.user_pack_open_events enable row level security;

grant usage on schema public to authenticated, service_role;
revoke all on table public.user_pack_open_events from anon;
revoke all on table public.user_pack_open_events from authenticated;
revoke all on table public.user_pack_open_events from public;
grant select on table public.user_pack_open_events to authenticated;
grant select, insert, update, delete on table public.user_pack_open_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_pack_open_events_client_event_id_nonempty'
  ) then
    alter table public.user_pack_open_events
      add constraint user_pack_open_events_client_event_id_nonempty
      check (length(trim(client_event_id)) > 0);
  end if;
end;
$$;

create index if not exists user_pack_open_events_user_id_created_at_idx
  on public.user_pack_open_events(user_id, created_at desc);

drop policy if exists "Users can read their own pack open events" on public.user_pack_open_events;
create policy "Users can read their own pack open events"
on public.user_pack_open_events
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own pack open events" on public.user_pack_open_events;
drop policy if exists "Users can update their own pack open events" on public.user_pack_open_events;
drop policy if exists "Users can delete their own pack open events" on public.user_pack_open_events;

create or replace function public.set_user_pack_open_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_pack_open_events_updated_at on public.user_pack_open_events;
create trigger set_user_pack_open_events_updated_at
before update on public.user_pack_open_events
for each row
execute function public.set_user_pack_open_events_updated_at();

create or replace function public.increment_user_profile_stats_for_user(
  target_user_id uuid,
  packs_opened_delta integer default 0,
  total_cards_pulled_delta integer default 0
)
returns table(packs_opened integer, total_cards_pulled integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profile_stats as stats (
    user_id,
    packs_opened,
    total_cards_pulled
  )
  values (
    target_user_id,
    greatest(packs_opened_delta, 0),
    greatest(total_cards_pulled_delta, 0)
  )
  on conflict (user_id) do update
    set packs_opened = stats.packs_opened + greatest(packs_opened_delta, 0),
        total_cards_pulled = stats.total_cards_pulled + greatest(total_cards_pulled_delta, 0),
        updated_at = now()
  returning stats.packs_opened, stats.total_cards_pulled
  into packs_opened, total_cards_pulled;

  return next;
end;
$$;

revoke all on function public.increment_user_profile_stats_for_user(uuid, integer, integer) from public;
revoke all on function public.increment_user_profile_stats_for_user(uuid, integer, integer) from anon;
revoke all on function public.increment_user_profile_stats_for_user(uuid, integer, integer) from authenticated;
grant execute on function public.increment_user_profile_stats_for_user(uuid, integer, integer) to service_role;
