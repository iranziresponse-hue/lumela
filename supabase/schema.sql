create extension if not exists postgis;
create extension if not exists pgcrypto;

-- `private` is not in PostgREST's exposed schema list, so nothing in it
-- is reachable over the API even if a grant were ever added by mistake --
-- a second layer of defense around the pepper on top of RLS.
create schema if not exists private;

create table if not exists private.app_secrets (
  id boolean primary key default true,
  report_hash_pepper text not null,
  constraint app_secrets_singleton check (id)
);

alter table private.app_secrets enable row level security;

-- security definer: public_reports (below) calls this while being queried
-- by anon, and anon must never get direct SELECT on app_secrets. Without
-- security definer, this function would run with anon's own privileges
-- and fail with "permission denied for schema private" the moment it
-- tries to read the table -- being owned by the view/table owner is what
-- lets it reach the secret on the caller's behalf.
create or replace function private.report_hash_pepper()
returns text
language plpgsql
security definer
set search_path = private
stable
as $$
declare
  pepper text;
begin
  select report_hash_pepper into pepper from private.app_secrets limit 1;

  if pepper is null or length(pepper) < 32 then
    raise exception 'private.app_secrets.report_hash_pepper is not configured -- see README "Security setup"';
  end if;

  return pepper;
end;
$$;

grant usage on schema private to anon, authenticated;
grant execute on function private.report_hash_pepper() to anon, authenticated;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('on', 'off')),
  lat double precision not null,
  lng double precision not null,
  phone_hash text not null,
  photo_url text,
  weight integer not null default 1,
  flags integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_hidden_idx on public.reports (hidden);
create index if not exists reports_phone_hash_created_at_idx on public.reports (phone_hash, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "Anyone can read visible reports" on public.reports;
drop policy if exists "Anyone can insert public reports" on public.reports;

-- Clients never touch this table directly. Reads go through the
-- public_reports view (which hashes phone_hash) and writes go through
-- submit_power_report (SECURITY DEFINER, runs as the table owner so it
-- doesn't need an RLS policy). Revoking the grants -- not just relying on
-- RLS -- also stops anyone from inserting spam rows that skip validation
-- and dedup, which matters for staying inside the free-tier row/storage cap.
revoke all on public.reports from anon, authenticated;

create or replace view public.public_reports
with (security_invoker = false)
as
select
  id,
  status,
  lat,
  lng,
  encode(
    hmac(phone_hash, private.report_hash_pepper(), 'sha256'),
    'hex'
  ) as reporter_key,
  photo_url,
  weight,
  flags,
  hidden,
  created_at
from public.reports
where hidden = false;

create or replace function public.submit_power_report(
  p_id uuid,
  p_status text,
  p_lat double precision,
  p_lng double precision,
  p_phone_hash text,
  p_photo_url text default null,
  p_weight integer default 1,
  p_created_at timestamptz default now()
)
returns table(accepted boolean, report_id uuid, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  duplicate_report_id uuid;
begin
  if p_status not in ('on', 'off') then
    return query select false, p_id, 'invalid_status';
    return;
  end if;

  -- Real-world coordinate range only, not a specific region: the app
  -- isn't tied to one city, so this rejects garbage input, not
  -- out-of-town reports.
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return query select false, p_id, 'invalid_location';
    return;
  end if;

  if p_phone_hash is null or length(p_phone_hash) < 24 then
    return query select false, p_id, 'invalid_reporter';
    return;
  end if;

  select reports.id
  into duplicate_report_id
  from public.reports
  where reports.phone_hash = p_phone_hash
    and reports.created_at >= p_created_at - interval '30 minutes'
    and reports.created_at <= p_created_at + interval '30 minutes'
    and ST_DWithin(
      ST_SetSRID(ST_MakePoint(reports.lng, reports.lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      1000
    )
  order by reports.created_at desc
  limit 1;

  if duplicate_report_id is not null then
    return query select false, duplicate_report_id, 'duplicate';
    return;
  end if;

  insert into public.reports (
    id,
    status,
    lat,
    lng,
    phone_hash,
    photo_url,
    weight,
    created_at
  )
  values (
    p_id,
    p_status,
    p_lat,
    p_lng,
    p_phone_hash,
    p_photo_url,
    greatest(1, least(coalesce(p_weight, 1), 3)),
    coalesce(p_created_at, now())
  )
  on conflict (id) do nothing;

  return query select true, p_id, 'accepted';
end;
$$;

grant select on public.public_reports to anon, authenticated;
grant execute on function public.submit_power_report(
  uuid,
  text,
  double precision,
  double precision,
  text,
  text,
  integer,
  timestamptz
) to anon, authenticated;
