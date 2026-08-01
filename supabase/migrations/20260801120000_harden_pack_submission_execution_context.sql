-- Keep the completed-pack transaction callable only by signed-in clients and
-- keep the retired event-only function restricted to trusted recovery work.
-- This migration changes no RLS policy and grants no new client capability.

alter function public.increment_collection_cards(jsonb)
  set search_path = public, pg_temp;

revoke all on function public.increment_collection_cards(jsonb)
  from public, anon, service_role;
grant execute on function public.increment_collection_cards(jsonb)
  to authenticated;

alter function public.record_pack_open_event(text, text, timestamptz)
  set search_path = public, pg_temp;

revoke all on function public.record_pack_open_event(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_pack_open_event(text, text, timestamptz)
  to service_role;
