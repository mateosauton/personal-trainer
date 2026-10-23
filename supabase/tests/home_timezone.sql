\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
do $$
declare owner uuid := gen_random_uuid(); message text;
begin
  insert into auth.users(id) values(owner);
  assert (select home_timezone='UTC' from public.profiles where id=owner), 'legacy fallback must be explicit UTC';
  perform set_config('request.jwt.claim.sub',owner::text,true);
  execute 'set local role authenticated';
  update public.profiles set home_timezone='America/Argentina/Buenos_Aires' where id=owner;
  assert (select home_timezone='America/Argentina/Buenos_Aires' from public.profiles where id=owner), 'valid home timezone rejected';
  begin
    update public.profiles set home_timezone='invalid/timezone' where id=owner;
    raise exception 'invalid timezone accepted';
  exception when raise_exception then
    get stacked diagnostics message = message_text;
    assert message='invalid home timezone', 'invalid timezone was not rejected';
  end;
  assert (select home_timezone='America/Argentina/Buenos_Aires' from public.profiles where id=owner), 'failed update changed timezone';
end;
$$;
rollback;
