create table if not exists public.public_pull_shares (
  share_code text primary key,
  set_id text not null,
  card_ids text[] not null,
  pack_number integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  constraint public_pull_shares_code_format check (share_code ~ '^[A-Za-z0-9_-]{10,12}$'),
  constraint public_pull_shares_card_count check (cardinality(card_ids) between 1 and 20),
  constraint public_pull_shares_expiry_after_creation check (expires_at > created_at)
);

alter table public.public_pull_shares enable row level security;
revoke all on public.public_pull_shares from public, anon, authenticated;
grant select, insert, delete on public.public_pull_shares to service_role;

-- The primary key serves exact-code reads. This is the only additional index,
-- used by the scheduled expiration cleanup.
create index if not exists public_pull_shares_expires_at_idx
  on public.public_pull_shares(expires_at);

create table if not exists public.public_pull_share_rate_limits (
  scope text not null,
  subject text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, subject, window_started_at),
  constraint public_pull_share_rate_limits_count_positive check (request_count >= 0)
);

alter table public.public_pull_share_rate_limits enable row level security;
revoke all on public.public_pull_share_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.public_pull_share_rate_limits to service_role;

create or replace function public.consume_public_pull_share_rate_limit(
  p_scope text,
  p_subject text,
  p_window_started_at timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if length(trim(coalesce(p_scope, ''))) = 0
     or length(trim(coalesce(p_subject, ''))) = 0
     or length(p_subject) > 200
     or p_limit < 1 then
    raise exception 'Invalid rate-limit input' using errcode = '22023';
  end if;

  insert into public.public_pull_share_rate_limits as limits(scope, subject, window_started_at, request_count)
  values (p_scope, p_subject, p_window_started_at, 1)
  on conflict (scope, subject, window_started_at) do update
    set request_count = limits.request_count + 1
    where limits.request_count < p_limit
  returning request_count into next_count;

  return next_count is not null;
end;
$$;

revoke all on function public.consume_public_pull_share_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_public_pull_share_rate_limit(text, text, timestamptz, integer) to service_role;

create or replace function public.cleanup_expired_public_pull_shares()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.public_pull_shares where expires_at <= now();
  delete from public.public_pull_share_rate_limits where window_started_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_expired_public_pull_shares() from public, anon, authenticated;
grant execute on function public.cleanup_expired_public_pull_shares() to service_role;

create extension if not exists pg_cron;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'cleanup-expired-public-pull-shares') then
    perform cron.schedule(
      'cleanup-expired-public-pull-shares',
      '17 3 * * *',
      'select public.cleanup_expired_public_pull_shares()'
    );
  end if;
end;
$$;
