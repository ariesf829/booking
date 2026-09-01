# Rally Reserve

Mobile-first tennis court booking SPA for two courts, built with vanilla HTML, CSS, and ES modules.

## Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

The UI runs in demo mode with `localStorage` so the complete booking interaction can be previewed without credentials. The ten-minute pending hold is represented in the browser and expired records remain stored as `cancelled`.

## Demo access

Click the `JD` avatar, then sign in with `admin@rallyreserve.test` and `admin123`. The avatar becomes `RA`; click it again to open the admin booking desk. This demo login is local-only and must be replaced with Supabase Auth before deployment.

## Supabase handoff

1. Run `supabase.sql` in the Supabase SQL editor.
2. Create a private Storage bucket named `payment-proofs` and add authenticated-user upload/read policies.
3. Connect the UI's booking insert and proof upload to Supabase Auth, Storage, and the `bookings` table.
4. Schedule `expire_pending_bookings()` with pg_cron.
5. Deploy `supabase/functions/confirm-booking/index.ts` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `BOOKING_NOTIFICATION_EMAIL` secrets. Invoke it after an admin confirms a booking.

The database's unique court/date/hour constraint prevents double booking at the backend boundary. Records use status transitions and are never hard deleted.
