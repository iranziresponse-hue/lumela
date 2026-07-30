# Lumela.ug PWA

Weekend MVP for Kampala power status reports.

## MVP Coverage

- `FR1.1`: POWER ON / POWER OFF report buttons without login
- `FR1.2`: geolocation, timestamp, and hashed phone/device identity
- `FR2.1`: Kampala map with power reports
- `FR2.2`: grey unverified dots, larger verified dots after 3 weighted reports in 30 minutes within 1 km
- `FR4.1`: WhatsApp sharing for latest selected area status
- `FR4.2`: installable PWA shell with offline app cache

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your Supabase and Mapbox values to `.env.local`.

```bash
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
NEXT_PUBLIC_MAPBOX_TOKEN=your_token
```

Run `supabase/schema.sql` in the Supabase SQL editor to create the `reports` table and public policies.
