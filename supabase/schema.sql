create extension if not exists postgis;

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

alter table public.reports enable row level security;

create policy "Anyone can read visible reports"
on public.reports for select
using (hidden = false);

create policy "Anyone can insert public reports"
on public.reports for insert
with check (
  status in ('on', 'off')
  and lat between -2 and 5
  and lng between 28 and 36
  and length(phone_hash) >= 24
);
