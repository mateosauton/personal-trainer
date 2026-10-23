-- Historical context remains explicitly unknown. Capture new context at INSERT,
-- together with the owned session, so a later profile edit cannot rewrite it.
alter table public.sessions
  add column calculation_units text,
  add column bodyweight_kg numeric,
  add column calculation_context_captured boolean not null default false,
  add constraint session_calculation_context_valid check (
    (not calculation_context_captured and calculation_units is null and bodyweight_kg is null)
    or (calculation_context_captured and calculation_units is not null
      and calculation_units in ('kg','lb')
      and (bodyweight_kg is null or bodyweight_kg between 0 and 100000))
  );

create function public.preserve_session_calculation_context()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  if new.calculation_units is distinct from old.calculation_units
    or new.bodyweight_kg is distinct from old.bodyweight_kg
    or new.calculation_context_captured is distinct from old.calculation_context_captured then
    raise exception 'Original workout calculation context is immutable' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_session_calculation_context() from public, anon, authenticated;
create trigger preserve_session_calculation_context
before update on public.sessions for each row
execute function public.preserve_session_calculation_context();

-- Existing sessions RLS still applies; export_account_data already selects
-- the complete owned session row, including these columns. ON DELETE cascades
-- remove context with the session. No historical profile values are inferred.
notify pgrst, 'reload schema';
