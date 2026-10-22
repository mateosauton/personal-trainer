-- Pair with the private-photo client before changing the hosted bucket.
update storage.buckets set public=false where id='avatars';
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

-- A deleted account's unexpired JWT must not recreate photo objects.
drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text
    and exists(select 1 from public.profiles where id=auth.uid()));
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text
    and exists(select 1 from public.profiles where id=auth.uid()));
