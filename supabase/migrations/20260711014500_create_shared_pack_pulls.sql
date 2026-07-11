create table if not exists public.shared_pack_pulls (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_id uuid not null unique,
  set_id text not null,
  ordered_card_ids text[] not null,
  best_pull_card_id text not null,
  created_at timestamptz not null default now(),
  constraint shared_pack_pulls_token_length check (length(share_token) between 16 and 64),
  constraint shared_pack_pulls_has_cards check (cardinality(ordered_card_ids) > 0)
);

alter table public.shared_pack_pulls enable row level security;
revoke all on table public.shared_pack_pulls from public, anon, authenticated;
grant select, insert on table public.shared_pack_pulls to service_role;

drop policy if exists "No direct shared pull access" on public.shared_pack_pulls;
create policy "No direct shared pull access"
on public.shared_pack_pulls for all to public using (false) with check (false);
