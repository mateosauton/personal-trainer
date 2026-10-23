begin;
insert into auth.users(id) values
  ('b701a9f2-77e1-4bd0-aec2-000000000001'),
  ('b701a9f2-77e1-4bd0-aec2-000000000002');
insert into storage.objects(bucket_id,name) values
  ('avatars','b701a9f2-77e1-4bd0-aec2-000000000001/avatar.jpeg'),
  ('avatars','b701a9f2-77e1-4bd0-aec2-000000000002/avatar.jpeg');
do $$begin
  assert (select not public from storage.buckets where id='avatars'), 'avatar bucket must be private';
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b701a9f2-77e1-4bd0-aec2-000000000001',true);
do $$begin
  assert (select count(*)=1 from storage.objects where bucket_id='avatars'), 'owner sees only own photo';
  assert (select name='b701a9f2-77e1-4bd0-aec2-000000000001/avatar.jpeg' from storage.objects where bucket_id='avatars'), 'foreign photo hidden';
  begin
    insert into storage.objects(bucket_id,name) values('avatars','b701a9f2-77e1-4bd0-aec2-000000000002/stolen.jpeg');
    raise exception 'foreign upload accepted';
  exception when insufficient_privilege then null; end;
end$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$begin
  assert (select count(*)=0 from storage.objects where bucket_id='avatars'), 'anonymous photo reads denied';
end$$;
reset role;
delete from auth.users where id='b701a9f2-77e1-4bd0-aec2-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b701a9f2-77e1-4bd0-aec2-000000000001',true);
do $$begin
  begin
    insert into storage.objects(bucket_id,name) values('avatars','b701a9f2-77e1-4bd0-aec2-000000000001/recreated.jpeg');
    raise exception 'deleted account recreated storage';
  exception when insufficient_privilege then null; end;
end$$;
reset role;
rollback;
