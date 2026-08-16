-- Personnalisation riche des pages scrapbook.
-- Migration rejouable : elle peut être exécutée plusieurs fois sans recréer les tables.

begin;

alter table public.day_journals
  add column if not exists design_settings jsonb not null
  default '{"style":"wanderlust","palette":"candy","paper":"grid","composition":"collage","font":"handwritten","decorations":"balanced","customAccent":"","customPaper":""}'::jsonb;

create or replace function public.publish_trip(target_trip uuid, settings jsonb)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  t public.trips;
  profile public.profiles;
  safe_slug text;
  payload jsonb;
  stats jsonb;
begin
  select * into t from public.trips where id=target_trip and owner_id=auth.uid();
  if t.id is null then raise exception 'Voyage non autorisé'; end if;

  select * into profile from public.profiles where id=auth.uid();
  stats:=public.trip_statistics(target_trip);
  safe_slug:=lower(regexp_replace(t.title,'[^a-zA-Z0-9]+','-','g'))||'-'||substr(t.id::text,1,8);
  payload:=jsonb_build_object(
    'trip',jsonb_build_object('id',t.id,'title',t.title,'country',t.country,'startDate',t.start_date,'endDate',t.end_date,'coverImage',t.cover_image),
    'author',jsonb_build_object('id',profile.id,'username',profile.username,'firstname',profile.firstname,'profilePicture',profile.profile_picture,'bio',profile.bio),
    'stats',stats
  );

  if coalesce((settings->>'story')::boolean,false) then
    payload:=payload||jsonb_build_object('days',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',d.day_date,
        'title',j.title,
        'summary',j.summary,
        'design',coalesce(j.design_settings,'{"style":"wanderlust","palette":"candy","paper":"grid","composition":"collage","font":"handwritten","decorations":"balanced","customAccent":"","customPaper":""}'::jsonb),
        'events',(select coalesce(jsonb_agg(jsonb_build_object('order',e.event_order,'title',e.title,'description',e.description,'place',e.place_text) order by e.event_order),'[]') from public.journal_events e where e.journal_id=j.id)
      ) order by d.day_date),'[]')
      from public.trip_days d
      left join public.day_journals j on j.trip_day_id=d.id
      where d.trip_id=t.id
    ));
  end if;

  if coalesce((settings->>'recommendations')::boolean,false) then
    payload:=payload||jsonb_build_object('places',(
      select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'city',p.city,'category',v.category,'liked',v.liked,'recommended',v.recommended,'comment',v.public_comment,'latitude',p.latitude,'longitude',p.longitude)),'[]')
      from public.place_visits v
      join public.trip_days d on d.id=v.trip_day_id
      join public.places p on p.id=v.place_id
      where d.trip_id=t.id
    ));
  end if;

  if coalesce((settings->>'budget')::boolean,false) then
    payload:=payload||jsonb_build_object('budget',jsonb_build_object('planned',t.planned_budget,'currency',t.currency,'spent',stats->'spent'));
  end if;

  insert into public.trip_publications(trip_id,owner_id,slug,visibility_settings,snapshot)
  values(t.id,auth.uid(),safe_slug,settings,payload)
  on conflict(trip_id) do update set visibility_settings=excluded.visibility_settings,snapshot=excluded.snapshot,published_at=now(),updated_at=now();

  update public.trips set visibility='public' where id=t.id;
  insert into public.profile_countries(user_id,country,manually_added) values(auth.uid(),t.country,false) on conflict do nothing;
  return safe_slug;
end;
$$;

grant execute on function public.publish_trip(uuid,jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
