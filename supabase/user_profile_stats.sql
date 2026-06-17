create table if not exists public.user_profile_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  packs_opened integer not null default 0,
  total_cards_pulled integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profile_stats enable row level security;

grant usage on schema public to authenticated, service_role;
grant select, insert, update on public.user_profile_stats to authenticated;
grant select, insert, update on public.user_profile_stats to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profile_stats_packs_opened_nonnegative'
  ) then
    alter table public.user_profile_stats
      add constraint user_profile_stats_packs_opened_nonnegative check (packs_opened >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_profile_stats_total_cards_pulled_nonnegative'
  ) then
    alter table public.user_profile_stats
      add constraint user_profile_stats_total_cards_pulled_nonnegative check (total_cards_pulled >= 0);
  end if;
end;
$$;

drop policy if exists "Users can read their own profile stats" on public.user_profile_stats;
create policy "Users can read their own profile stats"
on public.user_profile_stats
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own profile stats" on public.user_profile_stats;
create policy "Users can insert their own profile stats"
on public.user_profile_stats
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own profile stats" on public.user_profile_stats;
create policy "Users can update their own profile stats"
on public.user_profile_stats
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_profile_stats_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_profile_stats_updated_at on public.user_profile_stats;
create trigger set_user_profile_stats_updated_at
before update on public.user_profile_stats
for each row
execute function public.set_user_profile_stats_updated_at();
