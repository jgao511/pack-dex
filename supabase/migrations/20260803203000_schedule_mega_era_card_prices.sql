-- Extend the existing every-other-day price sync cadence to the six mapped
-- Mega Evolution-era sets that were added after batch 41. Reusing named jobs
-- keeps this migration idempotent if it is replayed.
select cron.schedule(
  'sync-card-prices-batch-42',
  '22 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['mega-evolution','phantasmal-flames','ascended-heroes']);$job$
);

select cron.schedule(
  'sync-card-prices-batch-43',
  '24 6 */2 * *',
  $job$select public.packdex_schedule_card_price_batch(array['perfect-order','chaos-rising','pitch-black']);$job$
);
