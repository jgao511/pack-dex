-- Keep the scheduler invocation count at the pre-repair baseline. The six
-- newly mapped sets are distributed across the final six existing batches;
-- the temporary batches 42 and 43 are then removed.
select cron.schedule(
  'sync-card-prices-batch-36',
  '10 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['silver-tempest','crown-zenith','scarlet-violet','mega-evolution']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-37',
  '12 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['paldea-evolved','obsidian-flames','151','phantasmal-flames']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-38',
  '14 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['paradox-rift','paldean-fates','temporal-forces','ascended-heroes']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-39',
  '16 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['twilight-masquerade','shrouded-fable','stellar-crown','perfect-order']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-40',
  '18 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['surging-sparks','prismatic-evolutions','journey-together','chaos-rising']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-41',
  '20 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['destined-rivals','black-bolt','white-flare','pitch-black']);$job$
);

select cron.unschedule(jobid)
from cron.job
where jobname in ('sync-card-prices-batch-42', 'sync-card-prices-batch-43');
