# Reserve

A mobile-first PWA that estimates your sperm and semen reserves. It shows how they refill after each release and when you're in your best fertility window.

## Model

Sperm and fluid are made in different places and refill at different speeds, so Reserve tracks them separately.

| | Sperm (epididymis) | Volume (seminal vesicles + prostate) |
|---|---|---|
| Full | 250M per ejaculate (set your own in Settings) | 3.0 mL, average for men 40–44 |
| Drained per release | ~60% | ~90% |
| Refill time constant | ~3 days | ~1.6 days |

**Fertility window** (time since your last release):

| Time | Phase | Why |
|---|---|---|
| < 1 day | Recharge | Very short gaps may slightly lower quality |
| 1–4 days | Prime | DNA damage lowest at 1–2 days; count building |
| 4–7 days | Good | Within the WHO 2–7 day range |
| > 7 days | Stale | Motility drops and DNA damage rises |

The chart shows both reserves as a percentage of full on a single axis. Shaded bands mark prime windows.

## Run

It's a static site with no build step:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To put it on your phone, host it over HTTPS (GitHub Pages works). Then open it and use **Share → Add to Home Screen** on iPhone or **Install app** on Android.

## Alerts

There are three alerts: prime window opens (24h after a release), a 7-day nudge, and volume full. Turn each on in Settings.

Safari home-screen apps (iOS 16.4+) can't schedule notifications on the device. They only show **server-sent Web Push**. So upcoming alerts go to a small push server in [`push-server/`](push-server/), a Cloudflare Worker with one Durable Object. It stores each device's push subscription and sets an alarm for the next alert. It generates its own VAPID keys on first run, so there are no keys to manage.

How it flows: the app subscribes to push, then sends `POST /sync` with its upcoming alert times on every release and settings change. When an alert is due, the Durable Object alarm fires and sends the push.

Without a push server configured (`PUSH_SERVER` in `app.js` is empty), alerts fall back to local notifications while the app is open, plus best-effort background delivery on Chromium.

### Deploying the push server

It deploys automatically through GitHub Actions (`.github/workflows/push-server.yml`) on pushes to `main` that touch `push-server/`. The free Cloudflare plan is enough.

1. Create a Cloudflare account and open **Workers & Pages** once, which sets up your `workers.dev` subdomain.
2. Create an API token from the **Edit Cloudflare Workers** template, and copy your **Account ID**.
3. Add both as repo secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Run the **Deploy push server** workflow. Then set `PUSH_SERVER` in `app.js` to the printed `https://reserve-push.<subdomain>.workers.dev` URL.

On iPhone, add the app to your Home Screen, open it from there, and turn on an alert. The permission prompt appears then.

Your release log stays on your device (`localStorage`). The push server only receives your push subscription and the times of upcoming alerts. Not a medical device.
