alter table public.user_welcome_rewards
  add column if not exists welcome_reward_claim_id text,
  add column if not exists welcome_reward_cards jsonb,
  add column if not exists welcome_reward_cards_saved_at timestamptz;

create unique index if not exists user_welcome_rewards_claim_id_key
  on public.user_welcome_rewards(welcome_reward_claim_id)
  where welcome_reward_claim_id is not null;

-- Review rows that were claimed before idempotency fields existed.
select
  user_id,
  welcome_god_pack_claimed,
  welcome_god_pack_set,
  welcome_reward_claimed_at,
  welcome_reward_claim_id,
  welcome_reward_cards_saved_at
from public.user_welcome_rewards
where welcome_god_pack_claimed = true
  and welcome_reward_cards_saved_at is null
order by welcome_reward_claimed_at desc;
