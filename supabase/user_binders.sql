create table if not exists public.user_binders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  binder_id text not null,
  name text not null,
  tag text not null,
  cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, binder_id)
);

alter table public.user_binders enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_binders to authenticated;

drop policy if exists "Users can select their binders" on public.user_binders;
create policy "Users can select their binders"
  on public.user_binders
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their binders" on public.user_binders;
create policy "Users can insert their binders"
  on public.user_binders
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their binders" on public.user_binders;
create policy "Users can update their binders"
  on public.user_binders
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their binders" on public.user_binders;
create policy "Users can delete their binders"
  on public.user_binders
  for delete
  using (auth.uid() = user_id);

create index if not exists user_binders_user_id_idx
  on public.user_binders(user_id);
