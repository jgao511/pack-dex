-- PackDex early beta data reset.
--
-- Run manually in the Supabase SQL editor when you are ready to reset tester
-- collection/reward data. This does not delete auth accounts.

create table if not exists public.user_collection_backup_pre_beta_reset as
select *
from public.user_collection;

create table if not exists public.user_welcome_rewards_backup_pre_beta_reset as
select *
from public.user_welcome_rewards;

delete from public.user_collection;
delete from public.user_welcome_rewards;

-- Optional verification:
-- select count(*) as remaining_collection_rows from public.user_collection;
-- select count(*) as remaining_reward_rows from public.user_welcome_rewards;
-- select count(*) as backed_up_collection_rows from public.user_collection_backup_pre_beta_reset;
-- select count(*) as backed_up_reward_rows from public.user_welcome_rewards_backup_pre_beta_reset;
