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

-- ============================================================
-- Sous-lot 2A · Communauté, relations, modération et messagerie
-- ============================================================
create type public.friendship_status as enum ('pending','accepted','rejected','blocked');
create type public.community_target as enum ('trip','day','recommendation');
create type public.message_kind as enum ('text','share');
create type public.message_permission as enum ('everyone','following','friends','nobody');
create type public.report_target as enum ('user','comment','message');
create type public.moderation_status as enum ('pending','reviewing','resolved','dismissed');
create type public.trip_audience as enum ('only_me','selected_people','friends','public');

alter table public.privacy_settings add column message_permission public.message_permission not null default 'everyone';
alter table public.trips add column audience public.trip_audience not null default 'only_me';

create table public.follows (
  id uuid primary key default gen_random_uuid(), follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  check(follower_id<>followed_id), unique(follower_id,followed_id)
);
create table public.friendships (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade, status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(), accepted_at timestamptz, check(requester_id<>recipient_id)
);
create unique index friendships_pair_unique on public.friendships(least(requester_id,recipient_id),greatest(requester_id,recipient_id));
create table public.community_likes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  target_type public.community_target not null, target_id uuid not null, created_at timestamptz not null default now(),
  unique(user_id,target_type,target_id)
);
create table public.comments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  target_type public.community_target not null check(target_type in ('trip','day')), target_id uuid not null,
  content text not null check(char_length(content) between 1 and 1500), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger comments_touch before update on public.comments for each row execute function public.touch_updated_at();
create table public.saved_trips (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade, created_at timestamptz not null default now(), unique(user_id,trip_id)
);
create table public.conversations (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, hidden_at timestamptz, joined_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade, message_type public.message_kind not null default 'text',
  content text check(content is null or char_length(content)<=4000), shared_entity_type public.community_target,
  shared_entity_id uuid, created_at timestamptz not null default now()
);
create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(), primary key(message_id,user_id)
);
create table public.user_blocks (
  id uuid primary key default gen_random_uuid(), blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  check(blocker_id<>blocked_id), unique(blocker_id,blocked_id)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type public.report_target not null, target_id uuid not null, reason text not null check(char_length(reason) between 3 and 500),
  details text, status public.moderation_status not null default 'pending', created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.trip_audience_members (trip_id uuid references public.trips(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,primary key(trip_id,user_id));

create or replace function public.users_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.user_blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a)); $$;
create or replace function public.are_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.friendships where status='accepted' and ((requester_id=a and recipient_id=b) or (requester_id=b and recipient_id=a))); $$;
create or replace function public.can_message(sender uuid,recipient uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare permission public.message_permission;
begin if sender=recipient or public.users_blocked(sender,recipient) then return false; end if;
select message_permission into permission from public.privacy_settings where user_id=recipient;
return case coalesce(permission,'everyone') when 'everyone' then true when 'following' then exists(select 1 from public.follows where follower_id=recipient and followed_id=sender) when 'friends' then public.are_friends(sender,recipient) else false end; end; $$;

create or replace function public.start_conversation(other_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare conversation uuid;
begin if not public.can_message(auth.uid(),other_user) then raise exception 'Cette personne n’accepte pas vos messages'; end if;
select cm1.conversation_id into conversation from public.conversation_members cm1 join public.conversation_members cm2 on cm2.conversation_id=cm1.conversation_id where cm1.user_id=auth.uid() and cm2.user_id=other_user and (select count(*) from public.conversation_members x where x.conversation_id=cm1.conversation_id)=2 limit 1;
if conversation is null then insert into public.conversations default values returning id into conversation; insert into public.conversation_members(conversation_id,user_id) values(conversation,auth.uid()),(conversation,other_user); end if; return conversation; end; $$;

create or replace function public.send_message(target_conversation uuid,body text,msg_type public.message_kind default 'text',entity_type public.community_target default null,entity_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare recipient uuid; result uuid;
begin if not exists(select 1 from public.conversation_members where conversation_id=target_conversation and user_id=auth.uid()) then raise exception 'Conversation non autorisée'; end if;
select user_id into recipient from public.conversation_members where conversation_id=target_conversation and user_id<>auth.uid() limit 1;
if recipient is null or not public.can_message(auth.uid(),recipient) then raise exception 'Message non autorisé'; end if;
insert into public.messages(conversation_id,sender_id,message_type,content,shared_entity_type,shared_entity_id) values(target_conversation,auth.uid(),msg_type,body,entity_type,entity_id) returning id into result; update public.conversation_members set hidden_at=null where conversation_id=target_conversation; return result; end; $$;

alter table public.follows enable row level security; alter table public.friendships enable row level security;
alter table public.community_likes enable row level security; alter table public.comments enable row level security;
alter table public.saved_trips enable row level security; alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security; alter table public.messages enable row level security;
alter table public.message_reads enable row level security; alter table public.user_blocks enable row level security;
alter table public.reports enable row level security; alter table public.trip_audience_members enable row level security;
create policy follows_read on public.follows for select using(not public.users_blocked(follower_id,followed_id)); create policy follows_own on public.follows for insert with check(follower_id=auth.uid() and not public.users_blocked(follower_id,followed_id)); create policy follows_delete on public.follows for delete using(follower_id=auth.uid());
create policy friendships_members_read on public.friendships for select using(auth.uid() in(requester_id,recipient_id)); create policy friendships_request on public.friendships for insert with check(requester_id=auth.uid() and status='pending' and not public.users_blocked(requester_id,recipient_id)); create policy friendships_members_update on public.friendships for update using(auth.uid() in(requester_id,recipient_id));
create policy likes_read on public.community_likes for select using(true); create policy likes_own on public.community_likes for insert with check(user_id=auth.uid()); create policy likes_delete on public.community_likes for delete using(user_id=auth.uid());
create policy comments_read on public.comments for select using(not public.users_blocked(auth.uid(),user_id)); create policy comments_create on public.comments for insert with check(user_id=auth.uid()); create policy comments_change on public.comments for update using(user_id=auth.uid()); create policy comments_delete on public.comments for delete using(user_id=auth.uid());
create policy saves_own on public.saved_trips for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy conversation_member_read on public.conversations for select using(exists(select 1 from public.conversation_members where conversation_id=id and user_id=auth.uid()));
create policy members_read on public.conversation_members for select using(exists(select 1 from public.conversation_members mine where mine.conversation_id=conversation_id and mine.user_id=auth.uid())); create policy members_hide on public.conversation_members for update using(user_id=auth.uid());
create policy messages_members_read on public.messages for select using(exists(select 1 from public.conversation_members where conversation_id=messages.conversation_id and user_id=auth.uid()));
create policy reads_own on public.message_reads for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy blocks_own on public.user_blocks for all using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
create policy reports_create on public.reports for insert with check(reporter_id=auth.uid()); create policy reports_own_read on public.reports for select using(reporter_id=auth.uid());
create policy audience_owner on public.trip_audience_members for all using(exists(select 1 from public.trips where id=trip_id and owner_id=auth.uid())) with check(exists(select 1 from public.trips where id=trip_id and owner_id=auth.uid()));
grant execute on function public.start_conversation(uuid) to authenticated; grant execute on function public.send_message(uuid,text,public.message_kind,public.community_target,uuid) to authenticated;

-- Évite toute récursion RLS lors de la lecture des membres d'une conversation.
create or replace function public.is_conversation_member(target_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.conversation_members where conversation_id=target_conversation and user_id=auth.uid()); $$;
drop policy if exists conversation_member_read on public.conversations;
drop policy if exists members_read on public.conversation_members;
drop policy if exists messages_members_read on public.messages;
create policy conversation_member_read on public.conversations for select using(public.is_conversation_member(id));
create policy members_read on public.conversation_members for select using(public.is_conversation_member(conversation_id));
create policy messages_members_read on public.messages for select using(public.is_conversation_member(conversation_id));

-- Version explicite de la création de conversation : erreurs métier lisibles côté client.
create or replace function public.start_conversation(other_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=auth.uid(); conversation_id_result uuid; permission public.message_permission;
begin
  if current_user_id is null then raise exception using errcode='P0001',message='AUTH_REQUIRED'; end if;
  if other_user is null or not exists(select 1 from auth.users where id=other_user) then raise exception using errcode='P0001',message='USER_NOT_FOUND'; end if;
  if current_user_id=other_user then raise exception using errcode='P0001',message='CANNOT_MESSAGE_SELF'; end if;
  if public.users_blocked(current_user_id,other_user) then raise exception using errcode='P0001',message='USER_BLOCKED'; end if;
  select coalesce(message_permission,'everyone') into permission from public.privacy_settings where user_id=other_user;
  permission:=coalesce(permission,'everyone');
  if permission='nobody' then raise exception using errcode='P0001',message='MESSAGES_DISABLED'; end if;
  if permission='following' and not exists(select 1 from public.follows where follower_id=other_user and followed_id=current_user_id) then raise exception using errcode='P0001',message='FOLLOW_REQUIRED'; end if;
  if permission='friends' and not public.are_friends(current_user_id,other_user) then raise exception using errcode='P0001',message='FRIENDSHIP_REQUIRED'; end if;
  select first_member.conversation_id into conversation_id_result from public.conversation_members first_member
  where first_member.user_id=current_user_id and exists(select 1 from public.conversation_members second_member where second_member.conversation_id=first_member.conversation_id and second_member.user_id=other_user)
  and (select count(*) from public.conversation_members member_count where member_count.conversation_id=first_member.conversation_id)=2 limit 1;
  if conversation_id_result is null then
    insert into public.conversations default values returning id into conversation_id_result;
    insert into public.conversation_members(conversation_id,user_id) values(conversation_id_result,current_user_id),(conversation_id_result,other_user);
  else update public.conversation_members set hidden_at=null where conversation_id=conversation_id_result and user_id=current_user_id;
  end if;
  return conversation_id_result;
end; $$;
grant execute on function public.start_conversation(uuid) to authenticated;

-- Les profils constituent l'identité publique de la communauté. Les données sensibles
-- restent dans traveler_profiles et privacy_settings, qui ne sont jamais exposées ici.
drop policy if exists profiles_community_read on public.profiles;
create policy profiles_community_read on public.profiles for select to authenticated using (true);

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
