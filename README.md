# Lumela PWA

Weekend MVP for crowdsourced power status reports. Not tied to any one city — reports, verification, and the map all work off the reporter's actual coordinates, wherever that is.

## MVP Coverage

- `FR1.1`: POWER ON / POWER OFF report buttons without login
- `FR1.2`: geolocation, timestamp, and hashed phone/device identity
- `FR2.1`: live map of power reports, centered on the user's own location
- `FR2.2`: grey unverified dots, larger verified dots after 3 weighted reports in 30 minutes within 1 km — the same rule applies in any location, there's no region allowlist
- `FR4.1`: WhatsApp sharing for latest selected area status
- `FR4.2`: installable PWA shell with offline app cache
- optional photo attachment per report, place search on the map, and community flagging that auto-hides a report after 3 independent flags

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your Supabase values to `.env.local`.

```bash
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

The map needs no key or setup: it renders with [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) (BSD-3-Clause) against [OpenFreeMap](https://openfreemap.org/)'s public vector tiles, which are free and unlimited with no account, API key, or billing possible. OpenFreeMap is a single-maintainer, donation-funded project with no uptime SLA — acceptable for an MVP, but worth knowing if this ever needs a contractual guarantee.

`npm install` also runs `scripts/copy-maplibre-worker.mjs` (a `postinstall` hook) to copy MapLibre's tile-parsing worker into `public/maplibre/`. That's not optional packaging noise: maplibre-gl v6 splits its worker into a file that imports a sibling module, and Next.js's webpack asset handling only copies the one file it's pointed at — so without this step the worker 404s on its own import and the map silently renders its background with no roads, labels, or data. `public/maplibre/` is gitignored and regenerated on every install.

Run `supabase/schema.sql` in the Supabase SQL editor to create the `reports` table, the `public_reports` view, the `submit_power_report`/`attach_report_photo`/`flag_report` RPCs, and the `report-photos` Storage bucket — all of it, including the bucket and its upload policy, is created by this one script.

### Security setup (required)

The `public_reports` view never exposes raw `phone_hash` — it returns a `reporter_key` that's an HMAC of the phone hash keyed by a server-side pepper. That pepper lives in `private.app_secrets` (a schema PostgREST never exposes) and **is not set by `schema.sql`** — the view raises an error until you set it, rather than silently hashing with a guessable default. Run this once in the SQL editor, right after `schema.sql`:

```sql
insert into private.app_secrets (report_hash_pepper)
values ('replace-with-a-random-64-char-hex-string')
on conflict (id) do update set report_hash_pepper = excluded.report_hash_pepper;
```

Generate the random value locally (never commit it) with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Moderation

A report is hidden automatically once 3 different devices flag it (`public.report_flags` enforces one flag per reporter server-side — the client-side "already flagged" state is just UX, not the real protection). There's no admin UI; that would need Supabase Auth wired up, which is out of scope for now. To review or reverse a hide, use the SQL editor:

```sql
select * from public.reports where hidden = true order by created_at desc;

-- Restore a false-positive: clear both the counter and the flag records,
-- or it's one flag away from instantly re-hiding.
update public.reports set flags = 0, hidden = false where id = '...';
delete from public.report_flags where report_id = '...';
```

Hiding a report does **not** delete its photo from Storage — the public URL under `report-photos/` keeps resolving even after the report is hidden. If a hidden report has a photo that needs to actually come down, delete the object from the Storage dashboard (bucket `report-photos`, filename `<report id>.jpg`) as a separate manual step.

### Free-tier notes

- All reads go through `public_reports` and all writes go through `submit_power_report`; the base `reports` table has `revoke all ... from anon, authenticated`, so a client can't read raw phone hashes or insert rows that skip validation/dedup — keeps a public, no-login app from being used to fill up the free-tier storage/row cap.
- The dashboard pauses its 60s polling loop while the browser tab is hidden, so a backgrounded tab doesn't keep spending read quota.
