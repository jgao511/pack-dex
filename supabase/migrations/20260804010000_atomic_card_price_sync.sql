create or replace function public.packdex_apply_card_price_sync(
  p_rows jsonb,
  p_set_id text,
  p_stale_card_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_input_count integer;
  v_distinct_count integer;
  v_invalid_id_count integer;
  v_wrong_set_count integer;
  v_rows_upserted integer := 0;
  v_stale_prices_deleted integer := 0;
  v_row_ids text[];
begin
  if nullif(btrim(p_set_id), '') is null then
    raise exception 'set id is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 1000 then
    raise exception 'row count must be between 1 and 1000';
  end if;
  if coalesce(cardinality(p_stale_card_ids), 0) > 1000 then
    raise exception 'stale card id count exceeds 1000';
  end if;

  select
    count(*),
    count(distinct row_data.card_id),
    count(*) filter (where nullif(btrim(row_data.card_id), '') is null),
    count(*) filter (where row_data.set_id is distinct from p_set_id),
    array_agg(row_data.card_id)
  into v_input_count, v_distinct_count, v_invalid_id_count, v_wrong_set_count, v_row_ids
  from jsonb_to_recordset(p_rows) as row_data(
    card_id text,
    set_id text,
    card_number text,
    name text,
    rarity text,
    price_type text,
    market_price_usd numeric,
    low_price_usd numeric,
    mid_price_usd numeric,
    high_price_usd numeric,
    direct_low_price_usd numeric,
    tcgplayer_url text,
    source_updated_at date,
    synced_at timestamptz
  );

  if v_input_count <> v_distinct_count or v_invalid_id_count <> 0 then
    raise exception 'rows contain missing or duplicate card ids';
  end if;
  if v_wrong_set_count <> 0 then
    raise exception 'rows contain a different set id';
  end if;

  with input_rows as (
    select *
    from jsonb_to_recordset(p_rows) as row_data(
      card_id text,
      set_id text,
      card_number text,
      name text,
      rarity text,
      price_type text,
      market_price_usd numeric,
      low_price_usd numeric,
      mid_price_usd numeric,
      high_price_usd numeric,
      direct_low_price_usd numeric,
      tcgplayer_url text,
      source_updated_at date,
      synced_at timestamptz
    )
  ), upserted as (
    insert into public.card_prices (
      card_id,
      set_id,
      card_number,
      name,
      rarity,
      price_type,
      market_price_usd,
      low_price_usd,
      mid_price_usd,
      high_price_usd,
      direct_low_price_usd,
      tcgplayer_url,
      source_updated_at,
      synced_at
    )
    select
      card_id,
      set_id,
      card_number,
      name,
      rarity,
      price_type,
      market_price_usd,
      low_price_usd,
      mid_price_usd,
      high_price_usd,
      direct_low_price_usd,
      tcgplayer_url,
      source_updated_at,
      coalesce(synced_at, now())
    from input_rows
    on conflict (card_id) do update set
      set_id = excluded.set_id,
      card_number = excluded.card_number,
      name = excluded.name,
      rarity = excluded.rarity,
      price_type = excluded.price_type,
      market_price_usd = excluded.market_price_usd,
      low_price_usd = excluded.low_price_usd,
      mid_price_usd = excluded.mid_price_usd,
      high_price_usd = excluded.high_price_usd,
      direct_low_price_usd = excluded.direct_low_price_usd,
      tcgplayer_url = excluded.tcgplayer_url,
      source_updated_at = excluded.source_updated_at,
      synced_at = excluded.synced_at
    returning 1
  )
  select count(*) into v_rows_upserted from upserted;

  delete from public.card_prices
  where set_id = p_set_id
    and card_id = any(coalesce(p_stale_card_ids, array[]::text[]))
    and not (card_id = any(v_row_ids));
  get diagnostics v_stale_prices_deleted = row_count;

  return jsonb_build_object(
    'rowsUpserted', v_rows_upserted,
    'stalePricesDeleted', v_stale_prices_deleted
  );
end;
$$;

revoke all on function public.packdex_apply_card_price_sync(jsonb, text, text[]) from public;
revoke all on function public.packdex_apply_card_price_sync(jsonb, text, text[]) from anon;
revoke all on function public.packdex_apply_card_price_sync(jsonb, text, text[]) from authenticated;
grant execute on function public.packdex_apply_card_price_sync(jsonb, text, text[]) to service_role;
