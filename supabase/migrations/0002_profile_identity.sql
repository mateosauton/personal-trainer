-- Onboarding now asks who you are, not just how you train: name, photo and
-- height join the profile. Height is stored in cm and converted for display,
-- the same way bodyweight is stored in kg.

alter table profiles
  add column if not exists height_cm  numeric,
  add column if not exists avatar_url text;

-- Avatars live in Storage rather than the profiles row: the bucket is public
-- so the app can render a plain URL, but writes stay scoped to the owner by
-- pathing every object under <uid>/.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_write  on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

create policy avatars_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
