-- PackDex one-time user_collection audit for malformed set_id values.
--
-- Run the SELECT sections first in the Supabase SQL editor.
-- The cleanup sections at the bottom are commented out on purpose.
-- They should only be used after reviewing the affected rows.

create or replace function pg_temp.packdex_try_parse_jsonb(value text)
returns jsonb
language plpgsql
as $$
begin
  return value::jsonb;
exception
  when others then
    return null;
end;
$$;

with valid_set_ids(set_id) as (
  values
    ('30th-anniversary'),
    ('xy0'),
    ('xy1'),
    ('xy2'),
    ('xy3'),
    ('xy4'),
    ('xy5'),
    ('dc1'),
    ('xy6'),
    ('xy7'),
    ('xy8'),
    ('xy9'),
    ('g1'),
    ('xy10'),
    ('xy11'),
    ('xy12'),
    ('sun-moon'),
    ('guardians-rising'),
    ('burning-shadows'),
    ('shining-legends'),
    ('crimson-invasion'),
    ('ultra-prism'),
    ('forbidden-light'),
    ('celestial-storm'),
    ('dragon-majesty'),
    ('lost-thunder'),
    ('team-up'),
    ('detective-pikachu'),
    ('unbroken-bonds'),
    ('unified-minds'),
    ('hidden-fates'),
    ('cosmic-eclipse'),
    ('sword-shield'),
    ('rebel-clash'),
    ('darkness-ablaze'),
    ('champions-path'),
    ('vivid-voltage'),
    ('shining-fates'),
    ('battle-styles'),
    ('chilling-reign'),
    ('evolving-skies'),
    ('celebrations'),
    ('fusion-strike'),
    ('brilliant-stars'),
    ('astral-radiance'),
    ('pokemon-go'),
    ('lost-origin'),
    ('silver-tempest'),
    ('crown-zenith'),
    ('scarlet-violet'),
    ('paldea-evolved'),
    ('obsidian-flames'),
    ('151'),
    ('paradox-rift'),
    ('paldean-fates'),
    ('temporal-forces'),
    ('twilight-masquerade'),
    ('shrouded-fable'),
    ('stellar-crown'),
    ('surging-sparks'),
    ('prismatic-evolutions'),
    ('journey-together'),
    ('destined-rivals'),
    ('black-bolt'),
    ('white-flare'),
    ('mega-evolution'),
    ('phantasmal-flames'),
    ('ascended-heroes'),
    ('perfect-order'),
    ('chaos-rising')
)
select
  uc.id,
  uc.user_id,
  uc.set_id,
  uc.card_id,
  uc.quantity,
  uc.card_name,
  uc.card_number,
  uc.rarity,
  uc.created_at,
  uc.updated_at
from public.user_collection uc
left join valid_set_ids valid on valid.set_id = uc.set_id
where valid.set_id is null
order by uc.updated_at desc;

-- Quick count by malformed set_id shape.
with valid_set_ids(set_id) as (
  values
    ('30th-anniversary'), ('xy0'), ('xy1'), ('xy2'), ('xy3'), ('xy4'), ('xy5'), ('dc1'), ('xy6'), ('xy7'), ('xy8'),
    ('xy9'), ('g1'), ('xy10'), ('xy11'), ('xy12'), ('sun-moon'), ('guardians-rising'), ('burning-shadows'),
    ('shining-legends'), ('crimson-invasion'), ('ultra-prism'), ('forbidden-light'), ('celestial-storm'),
    ('dragon-majesty'), ('lost-thunder'), ('team-up'), ('detective-pikachu'), ('unbroken-bonds'), ('unified-minds'),
    ('hidden-fates'), ('cosmic-eclipse'), ('sword-shield'), ('rebel-clash'), ('darkness-ablaze'), ('champions-path'),
    ('vivid-voltage'), ('shining-fates'), ('battle-styles'), ('chilling-reign'), ('evolving-skies'), ('celebrations'),
    ('fusion-strike'), ('brilliant-stars'), ('astral-radiance'), ('pokemon-go'), ('lost-origin'), ('silver-tempest'),
    ('crown-zenith'), ('scarlet-violet'), ('paldea-evolved'), ('obsidian-flames'), ('151'), ('paradox-rift'),
    ('paldean-fates'), ('temporal-forces'), ('twilight-masquerade'), ('shrouded-fable'), ('stellar-crown'),
    ('surging-sparks'), ('prismatic-evolutions'), ('journey-together'), ('destined-rivals'), ('black-bolt'),
    ('white-flare'), ('mega-evolution'), ('phantasmal-flames'), ('ascended-heroes'), ('perfect-order'), ('chaos-rising')
)
select
  case
    when uc.set_id = '[object Object]' then '[object Object]'
    when uc.set_id like '{%' then 'json-like object'
    when uc.set_id like '[%' then 'array-like value'
    when uc.set_id is null or btrim(uc.set_id) = '' then 'blank'
    else 'unknown set id'
  end as malformed_type,
  uc.set_id,
  count(*) as row_count
from public.user_collection uc
left join valid_set_ids valid on valid.set_id = uc.set_id
where valid.set_id is null
group by malformed_type, uc.set_id
order by row_count desc, uc.set_id;

-- If bad rows were created with a JSON-like set object, this preview attempts
-- to extract an id from the JSON object without changing data.
select
  id,
  user_id,
  set_id as malformed_set_id,
  pg_temp.packdex_try_parse_jsonb(set_id) ->> 'id' as extracted_set_id,
  card_id,
  quantity,
  card_name,
  updated_at
from public.user_collection
where set_id like '{%';

-- Cleanup option A: delete obviously unrecoverable rows for the currently
-- authenticated user only. Uncomment only after reviewing the SELECT output.
--
-- delete from public.user_collection
-- where user_id = auth.uid()
--   and (set_id = '[object Object]' or set_id is null or btrim(set_id) = '');

-- Cleanup option B: repair JSON-like set_id rows where the embedded object has
-- a known id. This can conflict if a correct row already exists for the same
-- user/set/card, so run the duplicate preview first.
--
-- with repaired as (
--   select
--     id,
--     user_id,
--     card_id,
--     pg_temp.packdex_try_parse_jsonb(set_id) ->> 'id' as repaired_set_id
--   from public.user_collection
--   where user_id = auth.uid()
--     and set_id like '{%'
--     and pg_temp.packdex_try_parse_jsonb(set_id) ? 'id'
-- )
-- select *
-- from repaired
-- where repaired_set_id is not null;
--
-- update public.user_collection uc
-- set set_id = pg_temp.packdex_try_parse_jsonb(uc.set_id) ->> 'id'
-- where uc.user_id = auth.uid()
--   and uc.set_id like '{%'
--   and pg_temp.packdex_try_parse_jsonb(uc.set_id) ? 'id';
