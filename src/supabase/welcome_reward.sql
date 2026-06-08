create table if not exists public.user_welcome_rewards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  welcome_god_pack_claimed boolean not null default false,
  welcome_god_pack_set text,
  welcome_reward_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_welcome_rewards enable row level security;

drop policy if exists "Users can read their own welcome reward" on public.user_welcome_rewards;
create policy "Users can read their own welcome reward"
on public.user_welcome_rewards
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create their own welcome reward" on public.user_welcome_rewards;
create policy "Users can create their own welcome reward"
on public.user_welcome_rewards
for insert
to authenticated
with check (auth.uid() = user_id and welcome_god_pack_claimed = false);

drop policy if exists "Users can claim their own welcome reward" on public.user_welcome_rewards;
create policy "Users can claim their own welcome reward"
on public.user_welcome_rewards
for update
to authenticated
using (auth.uid() = user_id and welcome_god_pack_claimed = false)
with check (auth.uid() = user_id and welcome_god_pack_claimed = true);

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
