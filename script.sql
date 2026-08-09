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
