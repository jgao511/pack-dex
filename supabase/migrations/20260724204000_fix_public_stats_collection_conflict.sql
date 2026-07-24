-- The function has output columns named set_id and card_id. Referencing the
-- collection constraint avoids PL/pgSQL treating those conflict columns as
-- ambiguous variables.
do $migration$
declare
  function_definition text;
  ambiguous_clause constant text := 'on conflict (user_id, set_id, card_id) do update';
  resolved_clause constant text :=
    'on conflict on constraint user_collection_user_id_set_id_card_id_key do update';
begin
  select pg_get_functiondef('public.increment_collection_cards(jsonb)'::regprocedure)
    into function_definition;

  if position(ambiguous_clause in function_definition) > 0 then
    execute replace(function_definition, ambiguous_clause, resolved_clause);
  elsif position(resolved_clause in function_definition) = 0 then
    raise exception 'Unable to locate the collection conflict clause';
  end if;
end;
$migration$;
