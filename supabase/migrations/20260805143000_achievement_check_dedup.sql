create table if not exists public.achievement_check_dedup (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('pack_and_collection', 'profile_reconcile')),
  progression_fingerprint text not null,
  request_id text not null,
  response_body jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  lease_expires_at timestamptz not null default (now() + interval '30 seconds'),
  primary key (user_id, scope, progression_fingerprint)
);

comment on table public.achievement_check_dedup is
  'Service-role-only idempotency claims for check-achievements by authoritative progression state.';

create index if not exists achievement_check_dedup_completed_at_idx
  on public.achievement_check_dedup (completed_at)
  where completed_at is not null;

alter table public.achievement_check_dedup enable row level security;
revoke all on table public.achievement_check_dedup from anon, authenticated;
grant select, insert, update, delete on table public.achievement_check_dedup to service_role;
