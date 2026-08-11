-- Odyssea · Sous-lot 1A · Schéma Supabase/PostgreSQL
-- À exécuter dans l'éditeur SQL Supabase. Les comptes vivent dans auth.users.
create extension if not exists pgcrypto;

create type public.trip_visibility as enum ('private', 'public');

-- Profil partageable : ne contient volontairement aucune réponse sensible.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 40),
  firstname text not null check (char_length(firstname) between 1 and 80),
  profile_picture text,
  bio text check (char_length(bio) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Questionnaire strictement privé, isolé physiquement du profil public.
create table public.traveler_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personality text,
  anxiety_level smallint check (anxiety_level between 1 and 5),
  noise_sensitivity smallint check (noise_sensitivity between 1 and 5),
  crowd_sensitivity smallint check (crowd_sensitivity between 1 and 5),
  dietary_preferences text[] not null default '{}',
  allergies text[] not null default '{}',
  mobility_preferences text,
  answers_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_discoverable boolean not null default false,
  public_trips_visible boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  country text not null check (char_length(country) between 1 and 120),
  start_date date not null,
  end_date date not null,
  currency char(3) not null default 'EUR' check (currency = upper(currency)),
  planned_budget numeric(12,2) check (planned_budget is null or planned_budget >= 0),
  visibility public.trip_visibility not null default 'private',
  cover_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_trip_dates check (end_date >= start_date),
  constraint reasonable_trip_length check (end_date - start_date <= 730)
);

create table public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  day_number integer not null check (day_number > 0),
  title text,
  notes text,
  created_at timestamptz not null default now(),
  unique (trip_id, day_date), unique (trip_id, day_number)
);

create index trips_owner_idx on public.trips(owner_id);
create index trips_public_idx on public.trips(created_at desc) where visibility = 'public';
create index trip_days_trip_idx on public.trip_days(trip_id, day_number);

create or replace function public.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger traveler_profiles_touch before update on public.traveler_profiles for each row execute function public.touch_updated_at();
create trigger privacy_settings_touch before update on public.privacy_settings for each row execute function public.touch_updated_at();
create trigger trips_touch before update on public.trips for each row execute function public.touch_updated_at();

-- Création du profil minimal à l'inscription. Les métadonnées sont envoyées via signUp().
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, firstname)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username',''), 'voyageur_' || substr(new.id::text, 1, 8)),
    coalesce(nullif(new.raw_user_meta_data ->> 'firstname',''), 'Voyageur')
  );
  insert into public.privacy_settings(user_id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Les journées suivent toujours la plage de dates, y compris après modification.
create or replace function public.sync_trip_days() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trip_days
  where trip_id = new.id and (day_date < new.start_date or day_date > new.end_date);

  insert into public.trip_days (trip_id, day_date, day_number)
  select new.id, d::date, (d::date - new.start_date) + 1
  from generate_series(new.start_date, new.end_date, interval '1 day') d
  on conflict (trip_id, day_date) do update
    set day_number = excluded.day_number;
  return new;
end; $$;
create trigger trips_sync_days after insert or update of start_date, end_date on public.trips
for each row execute function public.sync_trip_days();

alter table public.profiles enable row level security;
alter table public.traveler_profiles enable row level security;
alter table public.privacy_settings enable row level security;
alter table public.trips enable row level security;
alter table public.trip_days enable row level security;

-- Profil public : lecture du sien, ou lecture d'un profil ayant au moins un voyage public.
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.trips t where t.owner_id = profiles.id and t.visibility = 'public'
  )
);
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Aucune politique de lecture publique n'existe sur ces deux tables sensibles.
create policy traveler_select_own on public.traveler_profiles for select using (user_id = auth.uid());
create policy traveler_insert_own on public.traveler_profiles for insert with check (user_id = auth.uid());
create policy traveler_update_own on public.traveler_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy traveler_delete_own on public.traveler_profiles for delete using (user_id = auth.uid());
create policy privacy_all_own on public.privacy_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy trips_select on public.trips for select using (owner_id = auth.uid() or visibility = 'public');
create policy trips_insert on public.trips for insert with check (owner_id = auth.uid());
create policy trips_update on public.trips for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy trips_delete on public.trips for delete using (owner_id = auth.uid());

create policy trip_days_select on public.trip_days for select using (exists (
  select 1 from public.trips t where t.id = trip_days.trip_id and (t.owner_id = auth.uid() or t.visibility = 'public')
));
create policy trip_days_insert on public.trip_days for insert with check (exists (
  select 1 from public.trips t where t.id = trip_days.trip_id and t.owner_id = auth.uid()
));
create policy trip_days_update on public.trip_days for update using (exists (
  select 1 from public.trips t where t.id = trip_days.trip_id and t.owner_id = auth.uid()
));
create policy trip_days_delete on public.trip_days for delete using (exists (
  select 1 from public.trips t where t.id = trip_days.trip_id and t.owner_id = auth.uid()
));

-- Vue publique sûre : impossible d'y faire fuiter answers_json ou les sensibilités.
create view public.public_traveler_profiles
with (security_invoker = true) as
select p.id, p.username, p.firstname, p.profile_picture, p.bio
from public.profiles p;
grant select on public.public_traveler_profiles to anon, authenticated;
revoke all on public.traveler_profiles from anon;
grant select, insert, update, delete on public.traveler_profiles to authenticated;

-- ============================================================
-- Sous-lot 1B · Journal, médias, lieux, dépenses et IA
-- ============================================================
create type public.media_kind as enum ('photo', 'video', 'audio');
create type public.journal_status as enum ('draft', 'published');
create type public.place_candidate_status as enum ('pending', 'confirmed', 'rejected');

create table public.day_journals (
  id uuid primary key default gen_random_uuid(),
  trip_day_id uuid not null unique references public.trip_days(id) on delete cascade,
  title text,
  summary text,
  raw_text text,
  layout text not null default 'editorial' check (layout in ('editorial','timeline')),
  cover_media_id uuid,
  status public.journal_status not null default 'draft',
  ai_model text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trip_media (
  id uuid primary key default gen_random_uuid(),
  trip_day_id uuid not null references public.trip_days(id) on delete cascade,
  storage_path text not null unique,
  media_type public.media_kind not null,
  original_name text,
  caption text,
  captured_at timestamptz,
  event_id uuid,
  selected boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.day_journals add constraint day_journal_cover_fk foreign key (cover_media_id) references public.trip_media(id) on delete set null;

create table public.journal_events (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.day_journals(id) on delete cascade,
  event_order integer not null,
  event_type text not null default 'moment',
  event_time time,
  title text not null,
  description text,
  place_text text,
  category text,
  created_at timestamptz not null default now(),
  unique(journal_id, event_order)
);
alter table public.trip_media add constraint trip_media_event_fk foreign key (event_id) references public.journal_events(id) on delete set null;

create table public.places (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'manual',
  provider_place_id text,
  name text not null,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  category text,
  created_at timestamptz not null default now(),
  unique(provider, provider_place_id)
);

create table public.place_candidates (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.day_journals(id) on delete cascade,
  raw_mention text not null,
  name text not null,
  city text,
  category text,
  confidence numeric(4,3),
  status public.place_candidate_status not null default 'pending',
  resolved_place_id uuid references public.places(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.place_visits (
  id uuid primary key default gen_random_uuid(),
  trip_day_id uuid not null references public.trip_days(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete restrict,
  category text,
  liked boolean,
  recommended boolean,
  private_note text,
  public_comment text,
  visited_at time,
  created_at timestamptz not null default now(),
  unique(trip_day_id, place_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_day_id uuid not null references public.trip_days(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null check (currency = upper(currency)),
  category text,
  created_at timestamptz not null default now()
);

create table public.ai_journal_runs (
  id uuid primary key default gen_random_uuid(),
  trip_day_id uuid not null references public.trip_days(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  model text not null,
  status text not null check (status in ('processing','completed','failed')),
  input_chars integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger journals_touch before update on public.day_journals for each row execute function public.touch_updated_at();
create index trip_media_day_idx on public.trip_media(trip_day_id);
create index journal_events_journal_idx on public.journal_events(journal_id,event_order);
create index place_candidates_journal_idx on public.place_candidates(journal_id);
create index expenses_day_idx on public.expenses(trip_day_id);

create or replace function public.owns_trip_day(target_day uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trip_days d join public.trips t on t.id=d.trip_id where d.id=target_day and t.owner_id=auth.uid());
$$;

alter table public.day_journals enable row level security;
alter table public.trip_media enable row level security;
alter table public.journal_events enable row level security;
alter table public.places enable row level security;
alter table public.place_candidates enable row level security;
alter table public.place_visits enable row level security;
alter table public.expenses enable row level security;
alter table public.ai_journal_runs enable row level security;

create policy journals_owner_all on public.day_journals for all using (public.owns_trip_day(trip_day_id)) with check (public.owns_trip_day(trip_day_id));
create policy media_owner_all on public.trip_media for all using (public.owns_trip_day(trip_day_id)) with check (public.owns_trip_day(trip_day_id));
create policy events_owner_all on public.journal_events for all using (exists(select 1 from public.day_journals j where j.id=journal_id and public.owns_trip_day(j.trip_day_id))) with check (exists(select 1 from public.day_journals j where j.id=journal_id and public.owns_trip_day(j.trip_day_id)));
create policy candidates_owner_all on public.place_candidates for all using (exists(select 1 from public.day_journals j where j.id=journal_id and public.owns_trip_day(j.trip_day_id))) with check (exists(select 1 from public.day_journals j where j.id=journal_id and public.owns_trip_day(j.trip_day_id)));
create policy visits_owner_all on public.place_visits for all using (public.owns_trip_day(trip_day_id)) with check (public.owns_trip_day(trip_day_id));
create policy expenses_owner_all on public.expenses for all using (public.owns_trip_day(trip_day_id)) with check (public.owns_trip_day(trip_day_id));
create policy ai_runs_owner_select on public.ai_journal_runs for select using (requested_by=auth.uid());
create policy places_authenticated_read on public.places for select to authenticated using (true);
create policy places_authenticated_insert on public.places for insert to authenticated with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media','trip-media',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/webm','audio/mp4','audio/mpeg'])
on conflict (id) do nothing;
create policy trip_media_storage_select on storage.objects for select to authenticated using (bucket_id='trip-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy trip_media_storage_insert on storage.objects for insert to authenticated with check (bucket_id='trip-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy trip_media_storage_delete on storage.objects for delete to authenticated using (bucket_id='trip-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- ============================================================
-- Sous-lot 1C · Budget, carte, clôture et publication contrôlée
-- ============================================================
alter table public.expenses add column trip_id uuid references public.trips(id) on delete cascade;
alter table public.expenses add column converted_amount numeric(12,2) check (converted_amount is null or converted_amount >= 0);
alter table public.expenses add column converted_currency char(3);
alter table public.expenses add column description text;
alter table public.expenses add column place_id uuid references public.places(id) on delete set null;
alter table public.expenses add column expense_date date;
update public.expenses e set trip_id=d.trip_id, expense_date=d.day_date from public.trip_days d where d.id=e.trip_day_id;
alter table public.expenses alter column trip_id set not null;
alter table public.expenses alter column expense_date set not null;

alter table public.trips add column completed_at timestamptz;

create table public.trip_publications (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  visibility_settings jsonb not null,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_countries (
  user_id uuid not null references auth.users(id) on delete cascade,
  country text not null,
  manually_added boolean not null default true,
  primary key(user_id,country)
);

create trigger publications_touch before update on public.trip_publications for each row execute function public.touch_updated_at();
alter table public.trip_publications enable row level security;
alter table public.profile_countries enable row level security;
create policy publications_public_read on public.trip_publications for select using (true);
create policy publications_owner_delete on public.trip_publications for delete using (owner_id=auth.uid());
create policy countries_public_read on public.profile_countries for select using (true);
create policy countries_owner_all on public.profile_countries for all using(user_id=auth.uid()) with check(user_id=auth.uid());

create or replace function public.trip_statistics(target_trip uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.trips where id=target_trip and owner_id=auth.uid()) then raise exception 'Voyage non autorisé'; end if;
  select jsonb_build_object(
    'days', (t.end_date-t.start_date)+1,
    'cities', (select count(distinct p.city) from public.place_visits v join public.trip_days d on d.id=v.trip_day_id join public.places p on p.id=v.place_id where d.trip_id=t.id and p.city is not null),
    'places', (select count(*) from public.place_visits v join public.trip_days d on d.id=v.trip_day_id where d.trip_id=t.id),
    'photos', (select count(*) from public.trip_media m join public.trip_days d on d.id=m.trip_day_id where d.trip_id=t.id and m.media_type='photo'),
    'spent', coalesce((select sum(coalesce(e.converted_amount,e.amount)) from public.expenses e where e.trip_id=t.id),0),
    'restaurants', (select count(*) from public.place_visits v join public.trip_days d on d.id=v.trip_day_id where d.trip_id=t.id and lower(v.category) in ('restaurant','restauration')),
    'cafes', (select count(*) from public.place_visits v join public.trip_days d on d.id=v.trip_day_id where d.trip_id=t.id and lower(v.category) in ('café','cafe')),
    'activities', (select count(*) from public.place_visits v join public.trip_days d on d.id=v.trip_day_id where d.trip_id=t.id and lower(v.category) in ('activité','activite','musée','musee'))
  ) into result from public.trips t where t.id=target_trip;
  return result;
end; $$;

create or replace function public.finish_trip(target_trip uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stats jsonb;
begin
  if not exists(select 1 from public.trips where id=target_trip and owner_id=auth.uid()) then raise exception 'Voyage non autorisé'; end if;
  update public.trips set completed_at=now() where id=target_trip;
  stats:=public.trip_statistics(target_trip);
  return stats;
end; $$;

create or replace function public.publish_trip(target_trip uuid, settings jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare t public.trips; profile public.profiles; safe_slug text; payload jsonb; stats jsonb;
begin
  select * into t from public.trips where id=target_trip and owner_id=auth.uid();
  if t.id is null then raise exception 'Voyage non autorisé'; end if;
  select * into profile from public.profiles where id=auth.uid();
  stats:=public.trip_statistics(target_trip);
  safe_slug:=lower(regexp_replace(t.title,'[^a-zA-Z0-9]+','-','g'))||'-'||substr(t.id::text,1,8);
  payload:=jsonb_build_object('trip',jsonb_build_object('id',t.id,'title',t.title,'country',t.country,'startDate',t.start_date,'endDate',t.end_date,'coverImage',t.cover_image),'author',jsonb_build_object('id',profile.id,'username',profile.username,'firstname',profile.firstname,'profilePicture',profile.profile_picture,'bio',profile.bio),'stats',stats);
  if coalesce((settings->>'story')::boolean,false) then payload:=payload||jsonb_build_object('days',(select coalesce(jsonb_agg(jsonb_build_object('date',d.day_date,'title',j.title,'summary',j.summary,'events',(select coalesce(jsonb_agg(jsonb_build_object('order',e.event_order,'title',e.title,'description',e.description,'place',e.place_text) order by e.event_order),'[]') from public.journal_events e where e.journal_id=j.id)) order by d.day_date),'[]') from public.trip_days d left join public.day_journals j on j.trip_day_id=d.id where d.trip_id=t.id)); end if;
  if coalesce((settings->>'recommendations')::boolean,false) then payload:=payload||jsonb_build_object('places',(select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'city',p.city,'category',v.category,'liked',v.liked,'recommended',v.recommended,'comment',v.public_comment,'latitude',p.latitude,'longitude',p.longitude)),'[]') from public.place_visits v join public.trip_days d on d.id=v.trip_day_id join public.places p on p.id=v.place_id where d.trip_id=t.id)); end if;
  if coalesce((settings->>'budget')::boolean,false) then payload:=payload||jsonb_build_object('budget',jsonb_build_object('planned',t.planned_budget,'currency',t.currency,'spent',stats->'spent')); end if;
  insert into public.trip_publications(trip_id,owner_id,slug,visibility_settings,snapshot) values(t.id,auth.uid(),safe_slug,settings,payload) on conflict(trip_id) do update set visibility_settings=excluded.visibility_settings,snapshot=excluded.snapshot,published_at=now(),updated_at=now();
  update public.trips set visibility='public' where id=t.id;
  insert into public.profile_countries(user_id,country,manually_added) values(auth.uid(),t.country,false) on conflict do nothing;
  return safe_slug;
end; $$;

grant execute on function public.trip_statistics(uuid) to authenticated;
grant execute on function public.finish_trip(uuid) to authenticated;
grant execute on function public.publish_trip(uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('published-trip-media','published-trip-media',true,52428800,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy published_media_public_read on storage.objects for select using(bucket_id='published-trip-media');

-- Amélioration esthétique des carnets : un contenu, plusieurs moteurs de rendu.
alter table public.day_journals drop constraint if exists day_journals_layout_check;
alter table public.day_journals add constraint day_journals_layout_check check(layout in ('scrapbook','editorial','timeline'));
