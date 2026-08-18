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

  -- This RPC is directly callable by anyone with the anon key, independent
  -- of the client's own upload flow (which attaches photos afterward via
  -- attach_report_photo, below) -- so a malformed/oversized/foreign URL
  -- here must not be trusted either. Silently drop it rather than reject
  -- the whole report over a bad photo.
  if p_photo_url is not null
    and (
      length(p_photo_url) > 512
      or p_photo_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/report-photos/'
    )
  then
    p_photo_url := null;
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

-- Photo attachments -----------------------------------------------------
--
-- Uploaded straight to a public Storage bucket by the client, then linked
-- to a report via attach_report_photo. Reads need no policy at all --
-- `public = true` on the bucket bypasses RLS for SELECT entirely,
-- confirmed against Supabase's storage docs. The only write path is one
-- INSERT policy, and even that is scoped as tightly as anon access allows:
-- restricted to this bucket and to filenames shaped like
-- "<report id>.<ext>", tying every upload to a specific report instead of
-- leaving the bucket a completely open drop box.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "Anyone can upload report photos" on storage.objects;

create policy "Anyone can upload report photos"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'report-photos'
  and name ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
);

-- SECURITY DEFINER for the same reason submit_power_report is: anon has
-- no direct UPDATE grant on public.reports, so this is the only path a
-- client can use to attach a photo after the fact. Scoped to the original
-- reporter (phone_hash match) and to reports that don't already have a
-- photo, so a stranger can't attach to -- or overwrite -- someone else's
-- report.
create or replace function public.attach_report_photo(
  p_id uuid,
  p_photo_url text,
  p_phone_hash text
)
returns table(accepted boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_photo_url is null
    or length(p_photo_url) > 512
    or p_photo_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/report-photos/'
  then
    return query select false;
    return;
  end if;

  update public.reports
  set photo_url = p_photo_url
  where id = p_id
    and phone_hash = p_phone_hash
    and photo_url is null;

  return query select found;
end;
$$;

grant execute on function public.attach_report_photo(uuid, text, text) to anon, authenticated;

-- Report flagging / lightweight moderation -------------------------------
--
-- report_flags is the enforcement layer: one row per (report, reporter),
-- so flag_report can't be replayed by the same caller to hide a report
-- alone. Never exposed to clients directly -- only reachable through the
-- SECURITY DEFINER function below, same pattern as private.app_secrets.
create table if not exists public.report_flags (
  report_id uuid not null references public.reports(id) on delete cascade,
  reporter_hash text not null,
  created_at timestamptz not null default now(),
  primary key (report_id, reporter_hash)
);

alter table public.report_flags enable row level security;
revoke all on public.report_flags from anon, authenticated;

create or replace function public.flag_report(p_id uuid, p_reporter_hash text)
returns table(accepted boolean, hidden boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  is_hidden boolean;
begin
  if p_reporter_hash is null or length(p_reporter_hash) < 24 then
    return query select false, false;
    return;
  end if;

  insert into public.report_flags (report_id, reporter_hash)
  values (p_id, p_reporter_hash)
  on conflict do nothing;

  if not found then
    -- Already flagged by this reporter -- not an error, just a no-op.
    select reports.hidden into is_hidden from public.reports where id = p_id;
    return query select false, coalesce(is_hidden, false);
    return;
  end if;

  -- Three independent flags hide a report, same bar submit_power_report's
  -- verification weight uses for the opposite direction (MIN_VERIFIED_WEIGHT).
  --
  -- The RHS `reports.hidden` must be qualified: `returns table(..., hidden
  -- boolean)` implicitly declares `hidden` as a PL/pgSQL variable in this
  -- function's scope, so a bare `hidden` here is ambiguous between that
  -- variable and the column -- Postgres errors with 42702, it doesn't
  -- guess. The target on the LHS is unambiguous (SET targets are always
  -- columns) and must stay unqualified.
  update public.reports
  set flags = flags + 1,
      hidden = reports.hidden or (flags + 1) >= 3
  where id = p_id
  returning reports.hidden into is_hidden;

  if not found then
    return query select false, false;
    return;
  end if;

  return query select true, is_hidden;
end;
$$;

grant execute on function public.flag_report(uuid, text) to anon, authenticated;
