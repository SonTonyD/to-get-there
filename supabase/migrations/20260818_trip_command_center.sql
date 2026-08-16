-- Trip command center and quick day capture.
-- This migration is intentionally idempotent.

alter table if exists public.trip_media
  add column if not exists sort_order integer;

with ranked as (
  select id,row_number() over(partition by trip_day_id order by created_at,id)-1 as position
  from public.trip_media
)
update public.trip_media media set sort_order=ranked.position
from ranked where ranked.id=media.id and media.sort_order is null;

alter table if exists public.trip_media
  alter column sort_order set default 0;

create index if not exists trip_media_day_order_idx
  on public.trip_media(trip_day_id,sort_order,created_at);

alter table if exists public.day_journals
  add column if not exists last_step smallint not null default 1;

alter table if exists public.journal_events
  add column if not exists confidence numeric(4,3),
  add column if not exists review_reason text,
  add column if not exists review_status text not null default 'not_required';

update public.journal_events
set confidence=coalesce(confidence,1),review_status=coalesce(review_status,'not_required');

do $$
begin
  if not exists(select 1 from pg_constraint where conname='day_journals_last_step_check') then
    alter table public.day_journals add constraint day_journals_last_step_check check(last_step between 1 and 4);
  end if;
  if not exists(select 1 from pg_constraint where conname='journal_events_confidence_check') then
    alter table public.journal_events add constraint journal_events_confidence_check check(confidence is null or confidence between 0 and 1);
  end if;
  if not exists(select 1 from pg_constraint where conname='journal_events_review_status_check') then
    alter table public.journal_events add constraint journal_events_review_status_check check(review_status in('pending','confirmed','not_required'));
  end if;
end $$;

notify pgrst,'reload schema';
