-- C1: all plan writes are one transaction, preventing half-built plans.
create or replace function public.save_plan(plan jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_plan_id uuid;
  day_row record;
  block_row record;
  item_row record;
  new_day_id uuid;
  new_block_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(plan->'days') <> 'array'
     or jsonb_array_length(plan->'days') not between 1 and 7 then
    raise exception 'a plan must have between 1 and 7 days';
  end if;

  update public.plans set is_active = false
   where user_id = auth.uid() and is_active;

  insert into public.plans (user_id, name, split, weeks)
  values (auth.uid(), plan->>'name', plan->>'split', coalesce((plan->>'weeks')::int, 4))
  returning id into new_plan_id;

  for day_row in select value, ord from jsonb_array_elements(plan->'days') with ordinality as d(value, ord) loop
    insert into public.plan_days (plan_id, day_index, name, focus)
    values (new_plan_id, day_row.ord - 1, day_row.value->>'name', day_row.value->>'focus')
    returning id into new_day_id;
    for block_row in select value, ord from jsonb_array_elements(day_row.value->'blocks') with ordinality as b(value, ord) loop
      insert into public.plan_blocks (plan_day_id, block_index, kind, title, rounds, rest_seconds)
      values (new_day_id, block_row.ord - 1, (block_row.value->>'kind')::public.block_kind,
        block_row.value->>'title', (block_row.value->>'rounds')::int, (block_row.value->>'rest_seconds')::int)
      returning id into new_block_id;
      for item_row in select value, ord from jsonb_array_elements(block_row.value->'items') with ordinality as i(value, ord) loop
        insert into public.plan_items (block_id, item_index, exercise_id, sets, reps_low, reps_high, seconds, tempo, notes)
        values (new_block_id, item_row.ord - 1, item_row.value->>'exercise_id', (item_row.value->>'sets')::int,
          (item_row.value->>'reps_low')::int, (item_row.value->>'reps_high')::int,
          nullif(item_row.value->>'seconds', 'null')::int, item_row.value->>'tempo', item_row.value->>'notes');
      end loop;
    end loop;
  end loop;
  return new_plan_id;
end;
$$;

grant execute on function public.save_plan(jsonb) to authenticated;
