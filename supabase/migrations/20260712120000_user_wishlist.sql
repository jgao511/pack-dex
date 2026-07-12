create table if not exists public.user_wishlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id text not null,
  card_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, set_id, card_id)
);

alter table public.user_wishlist enable row level security;

revoke all on table public.user_wishlist from public, anon;
grant select, insert, delete on table public.user_wishlist to authenticated;

create policy "Users can read their own wishlist"
  on public.user_wishlist for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add to their own wishlist"
  on public.user_wishlist for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can remove from their own wishlist"
  on public.user_wishlist for delete to authenticated
  using ((select auth.uid()) = user_id);
