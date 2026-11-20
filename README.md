# Rally Reserve

Mobile-first tennis court booking SPA for two courts, built with vanilla HTML, CSS, and ES modules.

## Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

For GitHub Pages, this repository is published at `https://ariesf829.github.io/booking/`.

The UI runs in demo mode with `localStorage` when Firebase is not configured, so the complete booking interaction can be previewed without credentials. The ten-minute pending hold is represented in the browser and expired records remain stored as `cancelled`.

## Demo access

Click the `JD` avatar, then sign in with `admin@rallyreserve.test` and `admin123`. The avatar becomes `RA`; click it again to open the admin booking desk. When Firebase is configured, registration and sign-in use Firebase Authentication. The local demo login is available only while `config.js` contains placeholders.

## Firebase setup

1. In the Firebase console, create a project and register a Web app.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create a Firestore database and a Firebase Storage bucket.
4. Copy the Web app's Firebase configuration object into `config.js`, replacing every `your-*` placeholder.
5. In Authentication > Settings > Authorized domains, add `ariesf829.github.io`.
6. Install the Firebase CLI, sign in, and run `firebase use --add` in this project.
7. Deploy the included rules with `firebase deploy --only firestore:rules,storage`.

To grant admin access, create/sign in as the account once, then edit its `profiles/{uid}` Firestore document in the Firebase console and set `role` to `admin`. Firebase client configuration is intended to be public; authorization is enforced by `firestore.rules` and `storage.rules`.

Keep the placeholders in `config.js` to use demo mode without a backend. Firebase Authentication, Firestore, and Storage are used together once every placeholder is replaced.

Booking document IDs contain the date, court, and hour. Firestore rules allow customers to create but not overwrite those documents, preventing the same slot from being double booked.
