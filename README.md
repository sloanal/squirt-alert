# Reserve

A mobile-first PWA that estimates your reserve and how it refills over time.

- **Capacity:** 3.0 mL by default, the mean ejaculate volume for men aged about 40–44. You can change it in Settings.
- **Release:** each logged release drains about 90% of the current reserve.
- **Refill:** exponential, with a time constant of about 1.6 days. That gives roughly 50% after 1 day, 85% after 3 days and 98% after 6 days. "Full" is 95%.

## Run

It's a static site with no build step:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To put it on your phone, host it over HTTPS (GitHub Pages works). Then open it and use **Share → Add to Home Screen** on iPhone or **Install app** on Android.

## Full alerts

- **App open or in the background:** you get a local notification when the reserve hits full.
- **App closed:** Chromium browsers try Notification Triggers and then Periodic Background Sync. Both are best-effort and depend on the browser.
- **iPhone:** use **Settings → Calendar reminder**. It adds a calendar event with an alert at your projected full time, which is the most reliable option.

For server-sent push that always arrives, even when the app is closed, the app needs a small backend that sends Web Push (VAPID) at the full time.

Data stays on your device (`localStorage`). Not a medical device.
