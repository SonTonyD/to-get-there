-- Sous-lot 2B · recherche indexée, destinations et savoir communautaire
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(), type text not null check(type in ('country','city')),
  country_code text, country_name text not null, city_name text, latitude double precision, longitude double precision,
  search_name text not null default '',
  unique(type,country_name,city_name)
);
create unique index if not exists destinations_identity_idx on public.destinations(type,country_name,coalesce(city_name,''));
create table if not exists public.destination_stats (
  destination_id uuid primary key references public.destinations(id) on delete cascade,
  public_trip_count integer not null default 0, average_duration numeric(8,1), recommended_place_count integer not null default 0,
  month_distribution jsonb not null default '{}'::jsonb, public_budget_average numeric(12,2), last_calculated_at timestamptz not null default now()
);
create table if not exists public.trip_search_index (
  trip_id uuid primary key references public.trips(id) on delete cascade, publication_id uuid references public.trip_publications(id) on delete cascade,
  countries text[] not null default '{}', cities text[] not null default '{}', start_month smallint,
  duration_days integer, public_budget numeric(12,2), trip_type text, categories text[] not null default '{}',
  recommended_places uuid[] not null default '{}', route text[] not null default '{}', searchable_text text not null default '',
  search_vector tsvector,
  published_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists trip_search_vector_idx on public.trip_search_index using gin(search_vector);
create index if not exists trip_search_country_idx on public.trip_search_index using gin(countries);
create index if not exists trip_search_city_idx on public.trip_search_index using gin(cities);
create index if not exists trip_search_month_idx on public.trip_search_index(start_month);

create table if not exists public.place_stats (
  place_id uuid primary key references public.places(id) on delete cascade, visit_count integer not null default 0,
  like_count integer not null default 0, recommendation_count integer not null default 0,
  non_recommendation_count integer not null default 0, last_calculated_at timestamptz not null default now()
);
create table if not exists public.trip_advice (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid not null references public.destinations(id) on delete cascade, author_id uuid not null references auth.users(id) on delete cascade,
  recommend_destination text not null check(recommend_destination in ('yes','mixed','no')),
  recommend_period boolean, recommended_duration integer check(recommended_duration between 1 and 365),
  advice_text text check(char_length(advice_text) between 1 and 2500), visibility text not null default 'private' check(visibility in ('private','public')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(trip_id,destination_id)
);
create table if not exists public.budget_sharing_preferences (
  trip_id uuid primary key references public.trips(id) on delete cascade, show_exact_budget boolean not null default false,
  allow_anonymous_statistics boolean not null default false, updated_at timestamptz not null default now()
);

create or replace function public.refresh_trip_search_index(target_trip uuid) returns void language plpgsql security definer set search_path='' as $$
declare publication public.trip_publications; trip_row public.trips; city_list text[]; category_list text[]; place_ids uuid[]; route_list text[]; words text;
begin
 select * into publication from public.trip_publications where trip_id=target_trip;
 if publication.id is null then delete from public.trip_search_index where trip_id=target_trip; return; end if;
 select * into trip_row from public.trips where id=target_trip and visibility='public';
 if trip_row.id is null then delete from public.trip_search_index where trip_id=target_trip; return; end if;
 select coalesce(array_agg(distinct p.city) filter(where p.city is not null),'{}'),coalesce(array_agg(distinct coalesce(v.category,p.category)) filter(where coalesce(v.category,p.category) is not null),'{}'),
   coalesce(array_agg(distinct p.id) filter(where v.recommended=true),'{}')
 into city_list,category_list,place_ids from public.trip_days d left join public.place_visits v on v.trip_day_id=d.id left join public.places p on p.id=v.place_id where d.trip_id=target_trip;
 select coalesce(array_agg(city order by first_day),'{}') into route_list from (select p.city, min(d.day_number) first_day from public.trip_days d join public.place_visits v on v.trip_day_id=d.id join public.places p on p.id=v.place_id where d.trip_id=target_trip and p.city is not null group by p.city) ordered_cities;
 select concat_ws(' ',trip_row.title,trip_row.country,array_to_string(city_list,' '),array_to_string(category_list,' '),
   (select string_agg(concat_ws(' ',p.name,v.public_comment,j.title,j.summary),' ') from public.trip_days d left join public.day_journals j on j.trip_day_id=d.id left join public.place_visits v on v.trip_day_id=d.id left join public.places p on p.id=v.place_id where d.trip_id=target_trip)) into words;
 insert into public.trip_search_index(trip_id,publication_id,countries,cities,start_month,duration_days,public_budget,trip_type,categories,recommended_places,route,searchable_text,search_vector,published_at,updated_at)
 values(target_trip,publication.id,array[trip_row.country],city_list,extract(month from trip_row.start_date)::smallint,(trip_row.end_date-trip_row.start_date)+1,
   case when coalesce(publication.visibility_settings->>'budget','false')::boolean then trip_row.planned_budget end,
   case when cardinality(city_list)>=3 then 'roadtrip' when (trip_row.end_date-trip_row.start_date)+1<=5 then 'city' else 'slow' end,
   category_list,place_ids,route_list,words,to_tsvector('simple',extensions.unaccent(words)),publication.published_at,now()) on conflict(trip_id) do update set publication_id=excluded.publication_id,countries=excluded.countries,cities=excluded.cities,start_month=excluded.start_month,duration_days=excluded.duration_days,public_budget=excluded.public_budget,trip_type=excluded.trip_type,categories=excluded.categories,recommended_places=excluded.recommended_places,route=excluded.route,searchable_text=excluded.searchable_text,search_vector=excluded.search_vector,published_at=excluded.published_at,updated_at=now();
 insert into public.destinations(type,country_name,search_name) values('country',trip_row.country,lower(extensions.unaccent(trip_row.country))) on conflict do nothing;
 insert into public.destinations(type,country_name,city_name,search_name) select 'city',trip_row.country,city,lower(extensions.unaccent(city||' '||trip_row.country)) from unnest(city_list) city on conflict do nothing;
end $$;

create or replace function public.refresh_community_stats() returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.place_stats(place_id,visit_count,like_count,recommendation_count,non_recommendation_count,last_calculated_at)
 select p.id,count(v.id),count(v.id) filter(where v.liked=true),count(v.id) filter(where v.recommended=true),count(v.id) filter(where v.recommended=false),now()
 from public.places p left join public.place_visits v on v.place_id=p.id left join public.trip_days td on td.id=v.trip_day_id left join public.trips t on t.id=td.trip_id and t.visibility='public' group by p.id
 on conflict(place_id) do update set visit_count=excluded.visit_count,like_count=excluded.like_count,recommendation_count=excluded.recommendation_count,non_recommendation_count=excluded.non_recommendation_count,last_calculated_at=now();
 insert into public.destination_stats(destination_id,public_trip_count,average_duration,recommended_place_count,month_distribution,public_budget_average,last_calculated_at)
 select d.id,count(distinct i.trip_id),round(avg(i.duration_days),1),count(distinct rp),
   coalesce((select jsonb_object_agg(m,c) from (select start_month m,count(*) c from public.trip_search_index x where (d.type='country' and d.country_name=any(x.countries)) or (d.type='city' and d.city_name=any(x.cities)) group by start_month) months),'{}'),
   round(avg(i.public_budget) filter(where bsp.allow_anonymous_statistics=true),2),now()
 from public.destinations d left join public.trip_search_index i on (d.type='country' and d.country_name=any(i.countries)) or (d.type='city' and d.city_name=any(i.cities))
 left join public.budget_sharing_preferences bsp on bsp.trip_id=i.trip_id left join lateral unnest(coalesce(i.recommended_places,'{}')) rp on true group by d.id
 on conflict(destination_id) do update set public_trip_count=excluded.public_trip_count,average_duration=excluded.average_duration,recommended_place_count=excluded.recommended_place_count,month_distribution=excluded.month_distribution,public_budget_average=excluded.public_budget_average,last_calculated_at=now();
end $$;

create or replace function public.index_published_trip() returns trigger language plpgsql security definer set search_path='' as $$ begin perform public.refresh_trip_search_index(coalesce(new.trip_id,old.trip_id)); perform public.refresh_community_stats(); return coalesce(new,old); end $$;
drop trigger if exists trip_publication_search_index on public.trip_publications;
create trigger trip_publication_search_index after insert or update or delete on public.trip_publications for each row execute function public.index_published_trip();

create or replace function public.search_travel_base(search_query text default null,search_month integer default null,min_duration integer default null,max_duration integer default null,max_budget numeric default null,trip_kind text default null,place_category text default null,recommended_only boolean default false,recent_only boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized text:=lower(extensions.unaccent(coalesce(search_query,''))); detected_month int; clean_query text; result jsonb;
begin
 detected_month:=coalesce(nullif(search_month,0),(select m from (values(1,'janvier'),(2,'fevrier'),(2,'février'),(3,'mars'),(4,'avril'),(5,'mai'),(6,'juin'),(7,'juillet'),(8,'aout'),(8,'août'),(9,'septembre'),(10,'octobre'),(11,'novembre'),(12,'decembre'),(12,'décembre')) months(m,n) where normalized like '%'||extensions.unaccent(n)||'%' limit 1));
 clean_query:=btrim(regexp_replace(normalized,'janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre','','gi'));
 with matching as (select i.* from public.trip_search_index i where (clean_query='' or extensions.unaccent(lower(i.searchable_text)) like '%'||clean_query||'%') and (detected_month is null or i.start_month=detected_month) and (min_duration is null or i.duration_days>=min_duration) and (max_duration is null or i.duration_days<=max_duration) and (max_budget is null or i.public_budget<=max_budget) and (trip_kind is null or trip_kind='' or i.trip_type=trip_kind) and (place_category is null or place_category='' or place_category=any(i.categories)) and (not recommended_only or cardinality(i.recommended_places)>0) and (not recent_only or i.published_at>=now()-interval '18 months'))
 select jsonb_build_object('parsed',jsonb_build_object('query',clean_query,'month',detected_month),'trips',coalesce((select jsonb_agg(jsonb_build_object('trip_id',m.trip_id,'score',case when clean_query='' then 1 else extensions.similarity(extensions.unaccent(lower(m.searchable_text)),clean_query) end)) from matching m),'[]'),
 'destinations',coalesce((select jsonb_agg(to_jsonb(x)) from (select d.*,s.public_trip_count,s.recommended_place_count from public.destinations d join public.destination_stats s on s.destination_id=d.id where s.public_trip_count>0 and ((clean_query<>'' and d.search_name like '%'||clean_query||'%') or exists(select 1 from matching m where (d.type='country' and d.country_name=any(m.countries)) or (d.type='city' and d.city_name=any(m.cities)))) order by s.public_trip_count desc limit 12)x),'[]'),
 'places',coalesce((select jsonb_agg(to_jsonb(x)) from (select p.id,p.name,p.city,p.country,p.category,ps.*,case when ps.recommendation_count+ps.non_recommendation_count=0 then 0 else round(100.0*ps.recommendation_count/(ps.recommendation_count+ps.non_recommendation_count)) end recommendation_rate from public.places p join public.place_stats ps on ps.place_id=p.id where (clean_query='' or extensions.unaccent(lower(concat_ws(' ',p.name,p.city,p.country,p.category))) like '%'||clean_query||'%') and (place_category is null or place_category='' or p.category=place_category) order by ps.recommendation_count desc limit 20)x),'[]')) into result;
 return result;
end $$;

create or replace function public.destination_details(target_destination uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('destination',to_jsonb(d),'stats',to_jsonb(s),
 'routes',coalesce((select jsonb_agg(to_jsonb(r)) from (select array_to_string(i.route,' → ') route,count(*) trip_count from public.trip_search_index i where ((d.type='country' and d.country_name=any(i.countries)) or (d.type='city' and d.city_name=any(i.cities))) and cardinality(i.route)>1 group by i.route order by count(*) desc limit 8)r),'[]'),
 'places',coalesce((select jsonb_agg(to_jsonb(pv)) from (select p.id,p.name,p.city,p.category,ps.visit_count,ps.recommendation_count from public.places p join public.place_stats ps on ps.place_id=p.id where (d.type='country' and p.country=d.country_name) or (d.type='city' and p.city=d.city_name) order by ps.recommendation_count desc limit 20)pv),'[]'),
 'advice',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.trip_advice a where a.destination_id=d.id and a.visibility='public'),'[]'),
 'trips',coalesce((select jsonb_agg(jsonb_build_object('trip_id',i.trip_id,'title',t.title,'duration_days',i.duration_days,'start_month',i.start_month)) from public.trip_search_index i join public.trips t on t.id=i.trip_id where (d.type='country' and d.country_name=any(i.countries)) or (d.type='city' and d.city_name=any(i.cities))),'[]')) from public.destinations d join public.destination_stats s on s.destination_id=d.id where d.id=target_destination; $$;

create or replace function public.community_place_details(target_place uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('place',to_jsonb(p),'stats',to_jsonb(ps)||jsonb_build_object('recommendation_rate',case when ps.recommendation_count+ps.non_recommendation_count=0 then 0 else round(100.0*ps.recommendation_count/(ps.recommendation_count+ps.non_recommendation_count)) end),
'trips',coalesce((select jsonb_agg(distinct jsonb_build_object('trip_id',i.trip_id,'title',t.title,'country_name',t.country,'start_month',i.start_month)) from public.trip_search_index i join public.trips t on t.id=i.trip_id where target_place=any(i.recommended_places)),'[]')) from public.places p join public.place_stats ps on ps.place_id=p.id where p.id=target_place; $$;

alter table public.destinations enable row level security; alter table public.destination_stats enable row level security; alter table public.trip_search_index enable row level security; alter table public.place_stats enable row level security; alter table public.trip_advice enable row level security; alter table public.budget_sharing_preferences enable row level security;
drop policy if exists destinations_public_read on public.destinations; drop policy if exists destination_stats_public_read on public.destination_stats; drop policy if exists trip_index_public_read on public.trip_search_index; drop policy if exists place_stats_public_read on public.place_stats;
drop policy if exists advice_public_read on public.trip_advice; drop policy if exists advice_owner_write on public.trip_advice; drop policy if exists budget_owner on public.budget_sharing_preferences;
create policy destinations_public_read on public.destinations for select using(true); create policy destination_stats_public_read on public.destination_stats for select using(true); create policy trip_index_public_read on public.trip_search_index for select using(true); create policy place_stats_public_read on public.place_stats for select using(true);
create policy advice_public_read on public.trip_advice for select using(visibility='public' or author_id=auth.uid()); create policy advice_owner_write on public.trip_advice for all using(author_id=auth.uid()) with check(author_id=auth.uid() and exists(select 1 from public.trips where id=trip_id and owner_id=auth.uid()));
create policy budget_owner on public.budget_sharing_preferences for all using(exists(select 1 from public.trips where id=trip_id and owner_id=auth.uid())) with check(exists(select 1 from public.trips where id=trip_id and owner_id=auth.uid()));
grant execute on function public.search_travel_base(text,integer,integer,integer,numeric,text,text,boolean,boolean) to anon,authenticated;
grant execute on function public.destination_details(uuid) to anon,authenticated; grant execute on function public.community_place_details(uuid) to anon,authenticated;
create or replace function public.save_trip_feedback(target_trip uuid,destination_recommendation text,period_recommendation boolean,duration_recommendation integer,advice_body text,publish_advice boolean,show_budget boolean,anonymous_budget boolean) returns void language plpgsql security definer set search_path='' as $$
declare target_destination uuid; country_value text;
begin
 select country into country_value from public.trips where id=target_trip and owner_id=auth.uid(); if country_value is null then raise exception 'Voyage non autorisé'; end if;
 insert into public.destinations(type,country_name,search_name) values('country',country_value,lower(extensions.unaccent(country_value))) on conflict do nothing;
 select id into target_destination from public.destinations where type='country' and country_name=country_value limit 1;
 insert into public.trip_advice(trip_id,destination_id,author_id,recommend_destination,recommend_period,recommended_duration,advice_text,visibility) values(target_trip,target_destination,auth.uid(),destination_recommendation,period_recommendation,duration_recommendation,nullif(btrim(advice_body),''),case when publish_advice then 'public' else 'private' end) on conflict(trip_id,destination_id) do update set recommend_destination=excluded.recommend_destination,recommend_period=excluded.recommend_period,recommended_duration=excluded.recommended_duration,advice_text=excluded.advice_text,visibility=excluded.visibility,updated_at=now();
 insert into public.budget_sharing_preferences(trip_id,show_exact_budget,allow_anonymous_statistics) values(target_trip,show_budget,anonymous_budget) on conflict(trip_id) do update set show_exact_budget=excluded.show_exact_budget,allow_anonymous_statistics=excluded.allow_anonymous_statistics,updated_at=now(); perform public.refresh_community_stats();
end $$;
grant execute on function public.save_trip_feedback(uuid,text,boolean,integer,text,boolean,boolean,boolean) to authenticated;
do $$ declare trip_record record; begin for trip_record in select trip_id from public.trip_publications loop perform public.refresh_trip_search_index(trip_record.trip_id); end loop; perform public.refresh_community_stats(); end $$;
