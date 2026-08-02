-- Read-only PackDex completed-pack incident audit.
-- Run in production before proposing any user-data repair. This script makes no
-- changes and intentionally does not display card payloads or email addresses.

-- 1. Collection receipts with no corresponding pack event.
select receipt.user_id, receipt.client_event_id, receipt.created_at, receipt.cards_added
from public.user_collection_increment_events as receipt
left join public.user_pack_open_events as pack_event
  on pack_event.user_id = receipt.user_id
 and pack_event.client_event_id = receipt.client_event_id
where pack_event.user_id is null
order by receipt.created_at;

-- 2. Pack events with no corresponding collection receipt. Welcome/onboarding
-- events are reported separately because their server-owned paths are expected
-- not to use the normal collection receipt table.
select
  pack_event.user_id,
  pack_event.client_event_id,
  pack_event.set_id,
  pack_event.created_at,
  pack_event.client_event_id like 'welcome-god-pack:%' as welcome_reward,
  pack_event.client_event_id like 'mobile-onboarding:%' as onboarding
from public.user_pack_open_events as pack_event
left join public.user_collection_increment_events as receipt
  on receipt.user_id = pack_event.user_id
 and receipt.client_event_id = pack_event.client_event_id
where receipt.user_id is null
order by pack_event.created_at;

-- 3. Duplicate IDs. Both queries should return zero rows because the database
-- boundary is scoped to (user_id, client_event_id).
select user_id, client_event_id, count(*) as occurrences
from public.user_collection_increment_events
group by user_id, client_event_id
having count(*) > 1;

select user_id, client_event_id, count(*) as occurrences
from public.user_pack_open_events
group by user_id, client_event_id
having count(*) > 1;

-- 4. Users whose normal pack receipt/event activity diverged during the known
-- incident window. This estimates impact without claiming missing card identity.
with receipts as (
  select user_id, count(*) as receipt_count, coalesce(sum(cards_added), 0) as cards_added
  from public.user_collection_increment_events
  where created_at >= timestamptz '2026-08-02 03:00:00+00'
    and created_at < timestamptz '2026-08-02 13:00:00+00'
  group by user_id
), events as (
  select user_id, count(*) as event_count
  from public.user_pack_open_events
  where created_at >= timestamptz '2026-08-02 03:00:00+00'
    and created_at < timestamptz '2026-08-02 13:00:00+00'
  group by user_id
)
select
  coalesce(receipts.user_id, events.user_id) as user_id,
  coalesce(receipt_count, 0) as receipt_count,
  coalesce(event_count, 0) as event_count,
  coalesce(cards_added, 0) as cards_added,
  coalesce(receipt_count, 0) - coalesce(event_count, 0) as receipt_event_delta
from receipts
full join events using (user_id)
where coalesce(receipt_count, 0) <> coalesce(event_count, 0)
order by abs(coalesce(receipt_count, 0) - coalesce(event_count, 0)) desc;

-- 5. Legacy compatibility adoption after the bridge deploys.
select date_trunc('hour', first_used_at) as hour, outcome, count(*) as distinct_events
from public.user_pack_legacy_compat_events
group by 1, 2
order by 1 desc, 2;

-- 6. Verify both exactly-once constraints and effective function grants.
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.user_collection_increment_events'::regclass,
  'public.user_pack_open_events'::regclass
)
  and contype in ('p', 'u')
order by table_name::text, conname;

select
  role_name,
  has_function_privilege(role_name, 'public.increment_collection_cards(jsonb)', 'EXECUTE')
    as can_submit_completed_pack,
  has_function_privilege(role_name, 'public.record_pack_open_event(text,text,timestamptz)', 'EXECUTE')
    as can_use_temporary_legacy_bridge
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
order by role_name;

-- 7. List compatible backup tables without reading their user data.
select schemaname, tablename
from pg_tables
where schemaname = 'public'
  and tablename like '%backup%'
order by tablename;
