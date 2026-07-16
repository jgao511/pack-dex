-- Account deletion support for PackDex. This procedure is callable only by the
-- service role from the delete-account Edge Function after it verifies the JWT.
-- PostgreSQL executes the deletes as one transaction; re-running it is safe.
create or replace function public.delete_packdex_account_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    raise exception 'A target user id is required' using errcode = '22023';
  end if;

  delete from public.user_wishlist where user_id = target_user_id;
  delete from public.user_achievements where user_id = target_user_id;
  delete from public.user_binders where user_id = target_user_id;
  delete from public.user_collection_increment_events where user_id = target_user_id;
  delete from public.user_pack_open_events where user_id = target_user_id;
  delete from public.user_welcome_rewards where user_id = target_user_id;
  delete from public.user_profile_stats where user_id = target_user_id;
  delete from public.user_collection where user_id = target_user_id;
end;
$$;

revoke all on function public.delete_packdex_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_packdex_account_data(uuid) to service_role;
