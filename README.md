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

## Logging after the fact

Tap the clock button next to **Log release** to log one you couldn't log at the time. Pick a quick preset (1h ago, yesterday, …) or set an exact date and time. The same sheet lists your recent releases so you can delete a mistake. Every log and delete can be undone from the toast.

## Full alerts

- **Alerts available:** prime window opens (24h after a release), a 7-day nudge, and volume full. Turn each on in Settings.
- **App open or in the background:** you get a local notification when an alert comes due.
- **App closed:** Chromium browsers try Notification Triggers and then Periodic Background Sync. Both are best-effort and depend on the browser.
- **iPhone:** use **Settings → Calendar reminder**. It adds your next prime window to your calendar, with an alert when it opens, which is the most reliable option.

For server-sent push that always arrives, even when the app is closed, the app needs a small backend that sends Web Push (VAPID) at those times.

## Your data

Data stays on your device (`localStorage`). There is no server, so it's lost if you remove the app or clear site data. To guard against that:

- **Back up** in Settings saves a JSON file. On a phone it opens the share sheet, so you can pick **Save to Files**. **Restore** loads a backup and replaces what's on the device. Restoring can be undone from the toast.
- When there are changes that haven't been backed up for over a week, the Settings button shows a dot and the app reminds you, at most once every two days.
- The app asks the browser to keep its storage (`navigator.storage.persist()`), and Settings shows whether it's protected. On iPhone, use the Home Screen app: Safari can clear a site's data after 7 days without a visit.
- If the saved data can't be read, it's kept under `reserve.v1.unreadable` instead of being overwritten.

Not a medical device.
