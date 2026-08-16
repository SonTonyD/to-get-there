-- MVP Film souvenir.
-- Migration rejouable : les objets sont créés ou remplacés sans toucher aux données existantes.

begin;

create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_day_id uuid references public.trip_days(id) on delete set null,
  title text not null default 'Mon film souvenir',
  format text not null default 'vertical' check (format in ('vertical','horizontal')),
  target_duration integer not null default 30 check (target_duration in (30,60)),
  style_settings jsonb not null default '{"palette":"candy","music":"none","showText":true,"style":"scrapbook"}'::jsonb,
  status text not null default 'draft' check (status in ('draft','storyboard_ready','rendering','ready','failed')),
  latest_export_path text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  position integer not null,
  scene_type text not null default 'memory' check (scene_type in ('intro','memory','quote','outro')),
  duration numeric(5,2) not null default 3 check (duration between 1 and 12),
  title text not null default '',
  caption text not null default '',
  media_ids uuid[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, position)
);

create index if not exists video_projects_trip_idx on public.video_projects(trip_id, updated_at desc);
create index if not exists video_scenes_project_idx on public.video_scenes(project_id, position);

alter table public.video_projects enable row level security;
alter table public.video_scenes enable row level security;

drop policy if exists video_projects_owner_all on public.video_projects;
create policy video_projects_owner_all on public.video_projects for all
  using (user_id=auth.uid() and exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()))
  with check (user_id=auth.uid() and exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()));

drop policy if exists video_scenes_owner_all on public.video_scenes;
create policy video_scenes_owner_all on public.video_scenes for all
  using (exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid()))
  with check (exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid()));

drop trigger if exists video_projects_touch on public.video_projects;
create trigger video_projects_touch before update on public.video_projects for each row execute function public.touch_updated_at();
drop trigger if exists video_scenes_touch on public.video_scenes;
create trigger video_scenes_touch before update on public.video_scenes for each row execute function public.touch_updated_at();

create or replace function public.save_video_storyboard(
  target_project uuid,
  project_title text,
  project_format text,
  project_duration integer,
  project_style jsonb,
  storyboard jsonb
) returns public.video_projects
language plpgsql
security definer
set search_path=''
as $$
declare
  saved public.video_projects;
begin
  if not exists(select 1 from public.video_projects where id=target_project and user_id=auth.uid()) then
    raise exception 'VIDEO_PROJECT_FORBIDDEN';
  end if;
  if project_format not in ('vertical','horizontal') or project_duration not in (30,60) then
    raise exception 'VIDEO_PROJECT_INVALID';
  end if;

  update public.video_projects set
    title=left(coalesce(nullif(btrim(project_title),''),'Mon film souvenir'),120),
    format=project_format,
    target_duration=project_duration,
    style_settings=coalesce(project_style,'{}'::jsonb),
    status='storyboard_ready'
  where id=target_project returning * into saved;

  delete from public.video_scenes where project_id=target_project;
  insert into public.video_scenes(project_id,position,scene_type,duration,title,caption,media_ids,settings)
  select target_project,
    row_number() over ()-1,
    case when item->>'sceneType' in ('intro','memory','quote','outro') then item->>'sceneType' else 'memory' end,
    least(12,greatest(1,coalesce((item->>'duration')::numeric,3))),
    left(coalesce(item->>'title',''),120),
    left(coalesce(item->>'caption',''),500),
    coalesce(array(select jsonb_array_elements_text(coalesce(item->'mediaIds','[]'::jsonb))::uuid),'{}'::uuid[]),
    coalesce(item->'settings','{}'::jsonb)
  from jsonb_array_elements(coalesce(storyboard,'[]'::jsonb)) item;
  return saved;
end;
$$;

grant execute on function public.save_video_storyboard(uuid,text,text,integer,jsonb,jsonb) to authenticated;

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
