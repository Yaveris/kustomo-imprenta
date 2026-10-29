# Payment server: parked for later (Oct 16, 2026)

## Where things stand now (reverted)
- The app pays with GCash the old way, using `paymongo.secret.key` from `local.properties` (built into the app).
- The App Keys page shows PayMongo under "Needs a new app build" again, with no secret-key box.
- **Kept:** the Google key for address search can still be changed on App Keys without a rebuild. The map picture still uses `maps.api.key`.
- The app has no Firebase Functions dependency. The last compile before the revert passed. The revert itself
  hasn't been compiled yet: run Build → Compile All Sources once.
- Firebase: no functions were ever deployed. Switch the plan back to Spark if it's still on Blaze.

## What was built, ready to switch back on
- `Kustomo-ImprentaServer/`: a Node payment server for Render (Free Web Service). See README.md here.
  - `server.js` handles `POST /paymongo/create-source`, `/source-status`, `/create-payment` and `/check-key`, plus `GET /health`.
  - Every call needs the caller's Firebase sign-in (Bearer ID token). Disabled accounts are refused, only the
    customer who started a payment can complete it, and the charge is the amount approved in GCash.
  - Reads the key from Firestore `secrets/paymongo` using `FIREBASE_SERVICE_ACCOUNT` (set in Render → Environment).
  - Tested against fake Firebase and fake PayMongo: all checks passed. Not yet run on Render or with real PayMongo.
- `saved-server-version/`: the app and admin files from the server version.
  - `PayMongoService.kt`: calls the server with OkHttp and the ID token, and falls back to the built-in key when no
    address is saved or the server says it isn't ready (404 / failed-precondition).
  - `AppKeys.kt`: adds the `paymentServerUrl` field from `appConfig/keys`.
  - `CartScreen.kt`: wakes the server (`PayMongoService.wakeServer()`) when the cart opens.
  - `keys.html`:
    - "Payment server address" box, plus a write-only PayMongo secret key box that saves to `secrets/paymongo`
      and keeps only a hint.
    - "Check saved key" button, which calls `/paymongo/check-key`.
    - Render setup steps, and the `secrets` Firestore rule (read: never; write: super_admin).

## To switch it back on
1. Copy the 3 .kt files into `app/src/main/java/com/ksprintexpress/fitfusion/`, and `keys.html` into the Admin folder.
2. Deploy `Kustomo-ImprentaServer` on Render, following README.md.
3. On App Keys:
   1. Paste the server address.
   2. Publish the rule block.
   3. Save the PayMongo key.
   4. Press "Check saved key".
4. Place a test GCash order. Then empty `paymongo.secret.key` and rebuild.

## Not used any more
`functions/`, `firebase.json` and `.firebaserc` in the main project folder came from the first try (Firebase Cloud Functions,
which needs Blaze). They're safe to delete.
