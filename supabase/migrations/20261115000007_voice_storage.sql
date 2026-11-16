-- Голосовые записи диагностики: приватный бакет voice, у каждого своя папка voice/<user_id>/…
insert into storage.buckets (id, name, public, file_size_limit)
values ('voice', 'voice', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "voice: own read" on storage.objects;
drop policy if exists "voice: own insert" on storage.objects;
drop policy if exists "voice: own update" on storage.objects;
drop policy if exists "voice: own delete" on storage.objects;

create policy "voice: own read" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own update" on storage.objects for update to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
