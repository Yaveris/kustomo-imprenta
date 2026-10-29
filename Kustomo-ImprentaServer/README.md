# Kustomo-Imprenta payment server

Runs the GCash payment steps that need PayMongo's **secret** key, so the key never ships inside the app.
It runs on [Render](https://render.com) as a Web Service; Firebase stays on the free Spark plan.

- The shop pastes the PayMongo key on the admin site's **Payments** page. Only this server can read it.
- The server saves each order the moment PayMongo confirms the payment, so an order isn't lost if the customer
  closes the app after paying.
- The Payments page lists payments and sends refunds through this server.

Changing the key needs no new app build.

## Set up on Render (once, by whoever installs the system)

1. **Put this folder on GitHub.** Easiest: in the Admin repository, add this `Kustomo-ImprentaServer` folder and push.
   (Its `.gitignore` keeps service-account files out.)
2. **Service account file:** Firebase console → ⚙ **Project settings** → **Service accounts** →
   **Generate new private key**. A `.json` file downloads. Keep it private: don't commit it or send it to anyone.
3. **Render → New → Web Service** → pick the repository.
   - **Root Directory:** `Kustomo-ImprentaServer` (only if it's inside the Admin repository)
   - **Language:** Node · **Build command:** `npm install` · **Start command:** `npm start`
   - **Instance type:** Free works. It sleeps after 15 minutes without use, so the first payment after that waits
     up to a minute. A paid instance stays awake.
   - **Environment → Add environment variable:** name `FIREBASE_SERVICE_ACCOUNT`, value = open the downloaded
     `.json` file in Notepad, select all, and paste all of it.
4. **Deploy.** When the log says `Kustomo-Imprenta payment server on port …`, copy the address at the top of the page
   (like `https://kustomo-payments.onrender.com`).
5. **Admin site → Payments:**
   1. Open **Setup**, paste the address, press **Save address**.
   2. Paste the PayMongo secret key and press **Save key**. The page should say **Connected**.
6. **Firebase console → Firestore → Rules:** paste the rules from `firestore.rules` (or App Keys → For your
   developer) and **Publish**. They add the `secrets` and `paymongoSources` rules.
7. Place a test order with a `sk_test_` key. When it works, paste the `sk_live_` key on the Payments page, then
   empty `paymongo.secret.key` in `local.properties` and build the app once more so it carries no key at all.

Render sets `RENDER_EXTERNAL_URL` by itself; the server uses it to ask PayMongo to notify it about payments.
Nothing else needs setting.

## What it does

| Request | From | Does |
|---|---|---|
| `GET /health` | app | Wakes the server when checkout opens |
| `POST /paymongo/create-source` | app | Starts a GCash payment and keeps the order for it |
| `POST /paymongo/finish` | app | Takes the money once GCash says yes, saves the order, returns it |
| `POST /paymongo/webhook` | PayMongo | Same as `finish`, when PayMongo says the payment was approved |
| `POST /paymongo/check-key` | Payments page | Tests the saved key, says test or live, sets up PayMongo's notices (Super Admins) |
| `POST /paymongo/payments` | Payments page | The latest payments (staff) |
| `POST /paymongo/refund` | Payments page, "Can't take it" | Sends all or part of a payment back (Super Admins) |
| `POST /paymongo/source-status`, `/create-payment` | older app versions | Kept so older apps keep working |

Every request except `/health` and `/paymongo/webhook` needs the caller's Firebase sign-in
(`Authorization: Bearer <ID token>`). The webhook is checked with PayMongo's signature instead.
Disabled customers are refused, only the customer who started a payment can finish it, the amount must match the
order, and each payment is taken and each order saved only once.
