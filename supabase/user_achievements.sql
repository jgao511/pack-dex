-- PackDex durable account achievement storage.
-- Run this in the Supabase SQL editor before wiring server-side account achievement awards.
--
-- Guest achievements stay local-only and should not be written to this table.
-- Account achievements should be awarded by a Supabase Edge Function or another
-- trusted server-side path using the service role key, never by direct browser writes.

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  scope_type text not null default 'global',
  scope_key text not null default 'global',
  award_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'client',
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, award_key),
  unique(user_id, achievement_id, scope_type, scope_key)
);

alter table public.user_achievements enable row level security;

grant usage on schema public to authenticated, service_role;
revoke all on table public.user_achievements from anon;
revoke all on table public.user_achievements from authenticated;
revoke all on table public.user_achievements from public;
grant select on table public.user_achievements to authenticated;
grant select, insert, update, delete on table public.user_achievements to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_achievements_achievement_id_nonempty'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_achievement_id_nonempty
      check (length(trim(achievement_id)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_achievements_scope_type_nonempty'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_scope_type_nonempty
      check (length(trim(scope_type)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_achievements_scope_key_nonempty'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_scope_key_nonempty
      check (length(trim(scope_key)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_achievements_award_key_nonempty'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_award_key_nonempty
      check (length(trim(award_key)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_achievements_metadata_object'
  ) then
    alter table public.user_achievements
      add constraint user_achievements_metadata_object
      check (jsonb_typeof(metadata) = 'object');
  end if;
end;
$$;

create index if not exists user_achievements_user_id_awarded_at_idx
  on public.user_achievements(user_id, awarded_at desc);

create index if not exists user_achievements_user_id_achievement_id_idx
  on public.user_achievements(user_id, achievement_id);

create index if not exists user_achievements_user_id_scope_idx
  on public.user_achievements(user_id, scope_type, scope_key);

drop policy if exists "Users can read their own achievements" on public.user_achievements;
create policy "Users can read their own achievements"
on public.user_achievements
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own achievements" on public.user_achievements;
drop policy if exists "Users can update their own achievements" on public.user_achievements;
drop policy if exists "Users can delete their own achievements" on public.user_achievements;

-- No authenticated INSERT, UPDATE, or DELETE policies exist for this table.
-- Award writes should happen from trusted server-side code using service_role.

create or replace function public.set_user_achievements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_achievements_updated_at on public.user_achievements;
create trigger set_user_achievements_updated_at
before update on public.user_achievements
for each row
execute function public.set_user_achievements_updated_at();
