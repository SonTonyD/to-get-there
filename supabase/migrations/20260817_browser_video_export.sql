-- Remplace le worker Remotion/Render par un export MP4 effectué dans le navigateur.
-- Migration rejouable pour les bases ayant déjà installé le premier MVP vidéo.

begin;

alter table public.video_projects add column if not exists latest_export_path text;
alter table public.video_projects add column if not exists exported_at timestamptz;

-- Les anciens jobs serveur ne sont plus utilisés. Les MP4 du bucket restent conservés.
drop table if exists public.video_renders;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('video-renders','video-renders',false,524288000,array['video/mp4'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists video_renders_storage_select on storage.objects;
create policy video_renders_storage_select on storage.objects for select to authenticated
  using(bucket_id='video-renders' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists video_renders_storage_insert on storage.objects;
create policy video_renders_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='video-renders' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists video_renders_storage_update on storage.objects;
create policy video_renders_storage_update on storage.objects for update to authenticated
  using(bucket_id='video-renders' and (storage.foldername(name))[1]=auth.uid()::text)
  with check(bucket_id='video-renders' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists video_renders_storage_delete on storage.objects;
create policy video_renders_storage_delete on storage.objects for delete to authenticated
  using(bucket_id='video-renders' and (storage.foldername(name))[1]=auth.uid()::text);

commit;

notify pgrst, 'reload schema';
