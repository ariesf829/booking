# Rally Reserve

Mobile-first tennis court booking SPA for two courts, built with vanilla HTML, CSS, and ES modules.

## Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

For GitHub Pages, this repository is published at `https://ariesf829.github.io/booking/`.

The UI runs in demo mode with `localStorage` so the complete booking interaction can be previewed without credentials. The ten-minute pending hold is represented in the browser and expired records remain stored as `cancelled`.

## Demo access

Click the `JD` avatar, then sign in with `admin@rallyreserve.test` and `admin123`. The avatar becomes `RA`; click it again to open the admin booking desk. When Supabase is configured, registration and sign-in use Supabase Auth. The local demo login is available only while `config.js` contains placeholders.

## Supabase handoff

1. Run `supabase.sql` in the Supabase SQL editor.
2. Create a private Storage bucket named `payment-proofs` and add authenticated-user upload/read policies.
3. Connect the UI's booking insert and proof upload to Supabase Auth, Storage, and the `bookings` table.
4. Schedule `expire_pending_bookings()` with pg_cron.
5. Deploy `supabase/functions/confirm-booking/index.ts` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `BOOKING_NOTIFICATION_EMAIL` secrets. Invoke it after an admin confirms a booking.

In Supabase Auth settings, set the Site URL to `https://ariesf829.github.io/booking/` and add that same URL under Redirect URLs. Email sign-up passes the current page URL as `emailRedirectTo`, so add `http://localhost:4173/` there too for local testing.

The database's unique court/date/hour constraint prevents double booking at the backend boundary. Records use status transitions and are never hard deleted.
