-- PackDex security hardening for authenticated cloud collection data.
-- Run this in the Supabase SQL editor after deploying the required Edge Functions:
--   open-pack
--   claim-welcome-god-pack
--
-- The browser should never use a service role key. Edge Functions may use
-- SUPABASE_SERVICE_ROLE_KEY server-side only.

create table if not exists public.user_collection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id text not null,
  card_id text not null,
  quantity integer not null default 1,
  card_name text,
  card_number text,
  rarity text,
  image_url text,
  card_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, set_id, card_id)
);

alter table public.user_collection enable row level security;

grant usage on schema public to authenticated, service_role;
grant select on public.user_collection to authenticated;
revoke insert, update, delete on public.user_collection from authenticated;
grant select, insert, update on public.user_collection to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_collection_user_id_set_id_card_id_key'
  ) then
    alter table public.user_collection
      add constraint user_collection_user_id_set_id_card_id_key unique(user_id, set_id, card_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_collection_quantity_nonnegative'
  ) then
    alter table public.user_collection
      add constraint user_collection_quantity_nonnegative check (quantity >= 0);
  end if;
end;
$$;

drop policy if exists "Users can read their own collection" on public.user_collection;
create policy "Users can read their own collection"
on public.user_collection
for select
to authenticated
using (auth.uid() = user_id);

-- Do not create authenticated INSERT/UPDATE policies for user_collection.
-- Collection grants must happen through trusted backend code only.
drop policy if exists "Users can insert their own collection" on public.user_collection;
drop policy if exists "Users can update their own collection" on public.user_collection;
drop policy if exists "Users can upsert their own collection" on public.user_collection;
drop policy if exists "Users can sync their own collection" on public.user_collection;
drop policy if exists "Users can delete their own collection" on public.user_collection;
drop policy if exists "Users can reset their own collection" on public.user_collection;
drop policy if exists "Users can clear their own collection" on public.user_collection;

-- No authenticated INSERT, UPDATE, or DELETE policies exist for this table.
-- open-pack and claim-welcome-god-pack write collection rows with the server-side service role.

create or replace function public.set_user_collection_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_collection_updated_at on public.user_collection;
create trigger set_user_collection_updated_at
before update on public.user_collection
for each row
execute function public.set_user_collection_updated_at();

create table if not exists public.user_welcome_rewards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  welcome_god_pack_claimed boolean not null default false,
  welcome_god_pack_set text,
  welcome_reward_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_welcome_rewards enable row level security;

grant select on public.user_welcome_rewards to authenticated;
revoke insert, update, delete on public.user_welcome_rewards from authenticated;
grant select, insert, update on public.user_welcome_rewards to service_role;

drop policy if exists "Users can read their own welcome reward" on public.user_welcome_rewards;
create policy "Users can read their own welcome reward"
on public.user_welcome_rewards
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create their own welcome reward" on public.user_welcome_rewards;
drop policy if exists "Users can claim their own welcome reward" on public.user_welcome_rewards;
drop policy if exists "Users can update their own welcome reward" on public.user_welcome_rewards;
drop policy if exists "Users can delete their own welcome reward" on public.user_welcome_rewards;

-- No authenticated INSERT, UPDATE, or DELETE policies exist for this table.
-- claim-welcome-god-pack creates and updates reward rows with the server-side service role.

create or replace function public.set_user_welcome_rewards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_welcome_rewards_updated_at on public.user_welcome_rewards;
create trigger set_user_welcome_rewards_updated_at
before update on public.user_welcome_rewards
for each row
execute function public.set_user_welcome_rewards_updated_at();
