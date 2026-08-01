-- PackDex completed-pack post-deploy verification (read-only).
-- Run sections 1-10 in the Supabase SQL editor. Adjust the lookback intervals
-- as needed. Sections 11-12 are for Supabase Logs Explorer, not the SQL editor.

-- 1. Pack events per minute.
select
  date_trunc('minute', created_at) as minute,
  count(*) as pack_events
from public.user_pack_open_events
where created_at >= now() - interval '24 hours'
group by 1
order by 1 desc;

-- 2. Users exceeding 30 recorded events in a minute.
select
  user_id,
  date_trunc('minute', created_at) as minute,
  count(*) as pack_events
from public.user_pack_open_events
where created_at >= now() - interval '24 hours'
group by user_id, date_trunc('minute', created_at)
having count(*) > 30
order by minute desc, pack_events desc;

-- 3. Duplicate stable client event ids (expected: zero rows).
select user_id, client_event_id, count(*) as occurrences
from public.user_pack_open_events
group by user_id, client_event_id
having count(*) > 1
order by occurrences desc;

-- 4. Exact duplicate opened_at timestamps for one user.
select user_id, opened_at, count(*) as occurrences
from public.user_pack_open_events
where created_at >= now() - interval '24 hours'
group by user_id, opened_at
having count(*) > 1
order by opened_at desc;

-- 5. Consecutive events no more than 250 ms apart.
with ordered_events as (
  select
    user_id,
    client_event_id,
    created_at,
    lag(created_at) over (partition by user_id order by created_at, id) as prior_created_at
  from public.user_pack_open_events
  where created_at >= now() - interval '24 hours'
)
select
  user_id,
  client_event_id,
  prior_created_at,
  created_at,
  created_at - prior_created_at as elapsed
from ordered_events
where prior_created_at is not null
  and created_at - prior_created_at <= interval '250 milliseconds'
order by created_at desc;

-- 6. Collection receipts compared with pack events by user and day.
with collection_changes as (
  select
    user_id,
    created_at::date as day,
    count(*) as collection_receipts,
    coalesce(sum(cards_added), 0) as cards_added
  from public.user_collection_increment_events
  where created_at >= now() - interval '7 days'
  group by user_id, created_at::date
), pack_changes as (
  select
    user_id,
    created_at::date as day,
    count(*) as pack_events
  from public.user_pack_open_events
  where created_at >= now() - interval '7 days'
  group by user_id, created_at::date
)
select
  coalesce(collection_changes.user_id, pack_changes.user_id) as user_id,
  coalesce(collection_changes.day, pack_changes.day) as day,
  coalesce(collection_receipts, 0) as collection_receipts,
  coalesce(pack_events, 0) as pack_events,
  coalesce(cards_added, 0) as cards_added,
  coalesce(collection_receipts, 0) - coalesce(pack_events, 0) as receipt_event_delta
from collection_changes
full join pack_changes using (user_id, day)
where coalesce(collection_receipts, 0) <> coalesce(pack_events, 0)
order by day desc, user_id;

-- 7. Effective EXECUTE privileges for the two pack RPCs.
select
  role_name,
  has_function_privilege(role_name, 'public.increment_collection_cards(jsonb)', 'EXECUTE')
    as can_increment_collection_cards,
  has_function_privilege(role_name, 'public.record_pack_open_event(text,text,timestamptz)', 'EXECUTE')
    as can_record_pack_open_event
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
order by role_name;

-- 8. Definitions, owner, SECURITY DEFINER, and fixed search_path.
select
  procedure.oid::regprocedure as signature,
  pg_get_userbyid(procedure.proowner) as owner,
  procedure.prosecdef as security_definer,
  procedure.proconfig as function_settings,
  pg_get_functiondef(procedure.oid) as definition
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in ('increment_collection_cards', 'increment_collection_cards_v2_internal', 'record_pack_open_event')
order by procedure.oid::regprocedure::text;

-- 9. Rate-limit rejection volume. This should correlate with deliberate rapid
-- use and should not grow continuously while clients are idle.
select
  date_trunc('minute', rejected_at) as minute,
  reason,
  count(*) as rejections
from public.user_pack_open_rate_limit_rejections
where rejected_at >= now() - interval '24 hours'
group by 1, 2
order by 1 desc, 2;

-- 10. Application write volume by minute, without reading card payloads.
with writes as (
  select created_at, 'pack_event'::text as kind from public.user_pack_open_events
  where created_at >= now() - interval '24 hours'
  union all
  select created_at, 'collection_receipt'::text from public.user_collection_increment_events
  where created_at >= now() - interval '24 hours'
  union all
  select rejected_at, 'rate_rejection'::text from public.user_pack_open_rate_limit_rejections
  where rejected_at >= now() - interval '24 hours'
)
select date_trunc('minute', created_at) as minute, kind, count(*) as writes
from writes
group by 1, 2
order by 1 desc, 2;

-- 11. Supabase Logs Explorer only: count legacy permission failures in the
-- time range selected in the Logs Explorer UI (current ClickHouse syntax).
-- The primary Postgres database does not retain query-error history in a SQL
-- table, so this cannot be run in the database SQL editor.
/* Copy the query below into Logs Explorer and remove this block comment.
select count() as legacy_permission_errors
from logs
where source = 'postgres_logs'
  and log_attributes['parsed.sql_state_code'] = '42501'
  and match(event_message, 'permission denied for function record_pack_open_event');
*/

-- 12. Supabase Logs Explorer only: PostgreSQL error-code trend. After rollout,
-- 22023 completed-pack-count errors and retired-function 42501 errors should be
-- zero for new traffic. Controlled stale-shape rejections are successful calls.
/* Copy the query below into Logs Explorer and remove this block comment.
select
  log_attributes['parsed.sql_state_code'] as sql_state,
  event_message,
  count() as occurrences
from logs
where source = 'postgres_logs'
  and log_attributes['parsed.sql_state_code'] != '00000'
group by sql_state, event_message
order by occurrences desc;
*/
