-- Enrichit automatiquement les profils créés avec Google OAuth.
-- Migration idempotente : CREATE OR REPLACE peut être rejoué sans recréer de table.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_username text;
  generated_username text;
  display_firstname text;
begin
  requested_username := nullif(btrim(metadata ->> 'username'), '');
  generated_username := left(
    coalesce(
      nullif(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9._-]+', '', 'g'), ''),
      'voyageur'
    ),
    30
  ) || '_' || substr(new.id::text, 1, 8);
  display_firstname := coalesce(
    nullif(btrim(metadata ->> 'firstname'), ''),
    nullif(btrim(metadata ->> 'given_name'), ''),
    nullif(btrim(metadata ->> 'full_name'), ''),
    nullif(btrim(metadata ->> 'name'), ''),
    'Voyageur'
  );

  insert into public.profiles (id, username, firstname, profile_picture)
  values (
    new.id,
    coalesce(requested_username, generated_username),
    left(display_firstname, 80),
    coalesce(nullif(metadata ->> 'avatar_url', ''), nullif(metadata ->> 'picture', ''))
  );
  insert into public.privacy_settings(user_id) values (new.id);
  return new;
end;
$$;
