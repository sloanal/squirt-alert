'use strict';

/* ------------------------------------------------------------------
 * Model
 *
 * Two compartments that refill independently after each release.
 * Each follows  level(t) = cap − (cap − level₀) · e^(−t/τ).
 *
 * SPERM   (epididymal store) ~250M available per ejaculate when fully
 *         rested. A release takes ~60%. Slow refill (τ ≈ 3 d): count keeps
 *         rising with abstinence longer than volume does.
 * VOLUME  (seminal vesicles + prostate) ~3.0 mL, the mean for men 40–44.
 *         A release drains ~90%; refill τ ≈ 1.6 d (≈ 3 days to near-full
 *         on MRI; ~1.8 mL at 1 day → ~3.5 mL at 6+ days of abstinence).
 *
 * Fertility window (time since last release):
 *   < 1 d   recharge  — short abstinence may slightly lower quality
 *   1–4 d   prime     — lowest DNA fragmentation (1–2 d), count building
 *   4–7 d   good      — within WHO 2–7 d range
 *   > 7 d   stale     — motility drops and DNA fragmentation rises
 * ------------------------------------------------------------------ */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const KEY = 'reserve.v1';
const FULL = 0.95;

const COMPARTMENTS = {
  sperm: { capKey: 'spermCap', drain: 0.6, tau: 3.0 * DAY },
  vol: { capKey: 'cap', drain: 0.9, tau: 1.64 * DAY },
};

const WINDOW = [
  { id: 'recharge', until: 1 * DAY, label: 'Recharging', badge: 'Recharge', note: 'Quality is slightly lower within 24h' },
  { id: 'prime', until: 4 * DAY, label: 'Prime window', badge: 'Prime', note: 'Best balance of count and DNA quality' },
  { id: 'good', until: 7 * DAY, label: 'Good', badge: 'Good', note: 'Higher count, quality starting to age' },
  { id: 'stale', until: Infinity, label: 'Getting stale', badge: 'Stale', note: 'Motility and DNA quality decline past 7 days' },
];
const TRACK_SPAN = 10 * DAY;

const defaults = () => ({
  cap: 3.0,
  spermCap: 250,
  start: Date.now(),
  events: [],
  alerts: { prime: false, stale: false, full: false },
  notified: {},
});

const store = {
  load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch {}
    if (!s || !Array.isArray(s.events)) return defaults();
    // Migrate v1 state (volume only, single "notify" flag).
    const d = defaults();
    s.spermCap ??= d.spermCap;
    s.alerts ??= { ...d.alerts, full: !!s.notify };
    s.notified ??= {};
    delete s.notify;
    delete s.notifiedFor;
    return s;
  },
  save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  },
};

let state = store.load();

function levelAt(kind, t) {
  const { capKey, drain, tau } = COMPARTMENTS[kind];
  const cap = state[capKey];
  const refill = (level, dt) => cap - (cap - level) * Math.exp(-Math.max(0, dt) / tau);
  let level = cap;
  let prev = state.start;
  for (const e of state.events) {
    if (e > t) break;
    level = refill(level, e - prev) * (1 - drain);
    prev = e;
  }
  return refill(level, t - prev);
}

const fraction = (kind, t) => levelAt(kind, t) / state[COMPARTMENTS[kind].capKey];

function lastEventTs() {
  return state.events.length ? state.events[state.events.length - 1] : null;
}

/** Ms from `t` until compartment reaches FULL (0 if already full). */
function timeToFull(kind, t = Date.now()) {
  const { capKey, tau } = COMPARTMENTS[kind];
  const cap = state[capKey];
  const level = levelAt(kind, t);
  if (level >= FULL * cap) return 0;
  return tau * Math.log((cap - level) / (cap - FULL * cap));
}

function windowAt(t = Date.now()) {
  const last = lastEventTs();
  if (last == null || last > t) return null;
  const since = t - last;
  return { since, ...WINDOW.find((w) => since < w.until) };
}

/* ------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------ */
function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtSperm = (m) => (m >= 100 ? Math.round(m).toString() : m.toFixed(0));

/* ------------------------------------------------------------------
 * Hero, window card, stats
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
let shownValue = null;

function renderHero() {
  const now = Date.now();
  const sperm = levelAt('sperm', now);
  const vol = levelAt('vol', now);
  const w = windowAt(now);

  tweenValue(sperm);
  $('volValue').textContent = `${vol.toFixed(2)} mL`;
  $('since').textContent = w ? `${fmtDuration(w.since)} since release` : 'No releases yet';

  const status = $('status');
  status.dataset.phase = w ? w.id : 'none';
  status.textContent = w ? w.label : 'Rested';

  // Window card
  const card = document.querySelector('.window-card');
  card.dataset.phase = w ? w.id : 'none';
  $('windowBadge').textContent = w ? w.badge : '—';
  if (!w) {
    $('windowSub').textContent = 'Log a release to start tracking';
    $('marker').style.left = '0%';
  } else {
    let sub = w.note;
    if (w.id === 'recharge') sub = `Prime in ${fmtDuration(1 * DAY - w.since)}`;
    else if (w.id === 'prime') sub = `${w.note} · ${fmtDuration(4 * DAY - w.since)} left`;
    $('windowSub').textContent = sub;
    $('marker').style.left = `${Math.min(100, (w.since / TRACK_SPAN) * 100)}%`;
  }

  // Stats
  const ev = state.events;
  $('statLast').textContent = ev.length ? `${fmtDuration(now - ev[ev.length - 1])} ago` : '—';
  $('statWeek').textContent = ev.filter((e) => e > now - 7 * DAY).length;
  if (ev.length >= 2) {
    const recent = ev.slice(-10);
    $('statAvg').textContent = fmtDuration((recent[recent.length - 1] - recent[0]) / (recent.length - 1));
  } else {
    $('statAvg').textContent = '—';
  }
}

function tweenValue(target) {
  const el = $('value');
  const from = shownValue ?? target;
  shownValue = target;
  if (Math.abs(from - target) < 0.5 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmtSperm(target);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtSperm(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------
 * Chart — both compartments indexed to % of full on one axis
 * ------------------------------------------------------------------ */
const NS = 'http://www.w3.org/2000/svg';
let rangeDays = 7;
let geom = null;

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function sampleTimes(from, to, n) {
  const ts = [];
  for (let i = 0; i <= n; i++) ts.push(from + ((to - from) * i) / n);
  // Exact pre/post points at each release so drops are vertical.
  for (const e of state.events) if (e > from && e <= to) ts.push(e - 1, e);
  return ts.sort((a, b) => a - b);
}

function renderChart() {
  const svg = $('chartSvg');
  const { width: W, height: H } = svg.getBoundingClientRect();
  if (!W) return;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  const now = Date.now();
  const span = rangeDays * DAY;
  const left = now - span;
  const right = now + span * 0.22;
  const dataLeft = Math.max(left, state.start);

  const pad = { l: 34, r: 6, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (t) => pad.l + ((t - left) / (right - left)) * iw;
  const y = (f) => pad.t + ih - f * ih;
  geom = { x, y, left, right, dataLeft, pad, iw };

  // Prime-window bands: 1–4 days after each release, cut short by the next release.
  const evs = state.events;
  for (let i = 0; i < evs.length; i++) {
    const a = Math.max(evs[i] + 1 * DAY, left);
    const b = Math.min(evs[i] + 4 * DAY, evs[i + 1] ?? Infinity, right);
    if (b > a) el('rect', { class: 'band', x: x(a), y: pad.t, width: x(b) - x(a), height: ih }, svg);
  }

  // Grid + y labels
  for (const f of [0, 0.5, 1]) {
    el('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: y(f), y2: y(f) }, svg);
    el('text', { class: 'axis', x: pad.l - 8, y: y(f) + 3, 'text-anchor': 'end' }, svg).textContent = `${f * 100}%`;
  }

  // X ticks, aligned to local calendar boundaries
  const stepH = rangeDays === 1 ? 6 : rangeDays === 7 ? 48 : 24 * 7;
  const tick = new Date(left);
  tick.setMinutes(0, 0, 0);
  if (rangeDays === 1) tick.setHours(Math.ceil(tick.getHours() / 6) * 6);
  else tick.setHours(24);
  for (let t = tick.getTime(); t < now - span * 0.1; t += stepH * HOUR) {
    const d = new Date(t);
    const txt = rangeDays === 1
      ? d.toLocaleTimeString([], { hour: 'numeric' })
      : rangeDays === 7
        ? d.toLocaleDateString([], { weekday: 'short' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    el('text', { class: 'axis', x: x(t), y: H - 4, 'text-anchor': 'middle' }, svg).textContent = txt;
  }
  el('text', { class: 'axis', x: x(now), y: H - 4, 'text-anchor': 'middle' }, svg).textContent = 'Now';

  const hist = sampleTimes(dataLeft, now, 220);
  const proj = sampleTimes(now, right, 60);
  const pathFor = (kind, ts) => ts.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(fraction(kind, t)).toFixed(1)}`).join('');

  // Volume first (secondary), sperm on top (primary).
  for (const kind of ['vol', 'sperm']) {
    el('path', { class: `proj ${kind}`, d: pathFor(kind, proj) }, svg);
    el('path', { class: `line ${kind}`, d: pathFor(kind, hist) }, svg);
  }

  // Release markers at the bottom of each sperm drop
  for (const e of evs) {
    if (e >= dataLeft && e <= now) el('circle', { class: 'event', cx: x(e), cy: y(fraction('sperm', e)), r: 4 }, svg);
  }

  // Now markers
  for (const kind of ['vol', 'sperm']) {
    el('circle', { class: `now-dot ${kind}`, cx: x(now), cy: y(fraction(kind, now)), r: 5 }, svg);
  }

  // Hover layer
  geom.cross = el('line', { class: 'cross', y1: pad.t, y2: pad.t + ih, visibility: 'hidden' }, svg);
  geom.dots = ['vol', 'sperm'].map((k) => el('circle', { class: `cross-dot ${k}`, r: 5, visibility: 'hidden' }, svg));
}

function onPointer(ev) {
  if (!geom) return;
  const r = $('chartSvg').getBoundingClientRect();
  const { left, right, dataLeft, pad, iw } = geom;
  let t = left + ((ev.clientX - r.left - pad.l) / iw) * (right - left);
  t = Math.min(right, Math.max(dataLeft, t));
  const cx = geom.x(t);
  geom.cross.setAttribute('x1', cx);
  geom.cross.setAttribute('x2', cx);
  geom.cross.setAttribute('visibility', 'visible');
  ['vol', 'sperm'].forEach((k, i) => {
    geom.dots[i].setAttribute('cx', cx);
    geom.dots[i].setAttribute('cy', geom.y(fraction(k, t)));
    geom.dots[i].setAttribute('visibility', 'visible');
  });

  const w = windowAt(t);
  const tip = $('tip');
  tip.innerHTML =
    `<div class="tip-time">${t > Date.now() ? 'Projected · ' : ''}${fmtDay(t)} ${fmtTime(t)}${w ? ` · ${w.badge}` : ''}</div>` +
    `<div><i class="swatch sperm"></i><b>${fmtSperm(levelAt('sperm', t))}M</b> sperm</div>` +
    `<div><i class="swatch vol"></i><b>${levelAt('vol', t).toFixed(2)} mL</b> volume</div>`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(r.width - tw / 2, Math.max(tw / 2, cx))}px`;
}

function hideTip() {
  if (!geom) return;
  $('tip').hidden = true;
  geom.cross?.setAttribute('visibility', 'hidden');
  geom.dots?.forEach((d) => d.setAttribute('visibility', 'hidden'));
}

/* ------------------------------------------------------------------
 * Alerts
 * ------------------------------------------------------------------ */
let swReg = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = await navigator.serviceWorker.register('sw.js'); } catch {}
  return swReg;
}

/** Upcoming alert moments for the current refill cycle. */
function plannedAlerts() {
  const last = lastEventTs();
  if (last == null) return [];
  const volFullAt = Date.now() + timeToFull('vol');
  return [
    { id: 'prime', at: last + 1 * DAY, title: 'Prime window open', body: 'Sperm quality and count are in a good balance for the next ~3 days.' },
    { id: 'stale', at: last + 7 * DAY, title: "It's been 7 days", body: 'Motility and DNA quality start to decline. A release resets the clock.' },
    { id: 'full', at: volFullAt, title: 'Volume full', body: `Fluid is back to ${state.cap.toFixed(1)} mL.` },
  ]
    .filter((a) => state.alerts[a.id])
    .map((a) => ({ ...a, key: `${a.id}:${last}` }))
    .filter((a) => !state.notified[a.key]);
}

function updateAlertUI() {
  const supported = 'Notification' in window;
  const denied = supported && Notification.permission === 'denied';
  document.querySelectorAll('[data-alert]').forEach((input) => {
    input.disabled = !supported;
    input.checked = supported && !denied && state.alerts[input.dataset.alert];
  });
  const sub = $('notifSub');
  if (!supported) {
    sub.textContent = /iP(hone|ad)/.test(navigator.userAgent)
      ? 'On iPhone, use Share → Add to Home Screen first'
      : 'Notifications not supported in this browser';
  } else if (denied) {
    sub.textContent = 'Notifications blocked. Enable them in system settings.';
  } else {
    sub.textContent = '24h after a release';
  }
}

async function setAlert(id, on) {
  if (on && Notification.permission !== 'granted') {
    on = (await Notification.requestPermission()) === 'granted';
  }
  state.alerts[id] = on;
  // Don't fire for moments that already passed before the alert was switched on.
  if (on) plannedAlerts().filter((a) => a.at <= Date.now()).forEach((a) => (state.notified[a.key] = true));
  store.save(state);
  updateAlertUI();
  scheduleAlerts();
}

async function notify(title, body) {
  const opts = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'reserve' };
  try {
    const reg = swReg || (await navigator.serviceWorker?.ready);
    if (reg) return reg.showNotification(title, opts);
  } catch {}
  try { new Notification(title, opts); } catch {}
}

/** Fire any alert whose moment has passed, once per refill cycle. */
function checkAlerts() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  // Only the most recent due alert is shown, so reopening after days away doesn't stack three.
  const due = plannedAlerts().filter((a) => a.at <= now);
  if (!due.length) return;
  due.forEach((a) => (state.notified[a.key] = true));
  store.save(state);
  const latest = due.sort((a, b) => b.at - a.at)[0];
  notify(latest.title, latest.body);
}

/**
 * Hand upcoming alerts to the service worker so they can fire while the
 * app is closed: Notification Triggers where available, otherwise periodic
 * background sync (installed PWAs on Chromium).
 */
async function scheduleAlerts() {
  const reg = swReg || (await navigator.serviceWorker?.ready.catch(() => null));
  if (!reg) return;
  const upcoming = plannedAlerts().filter((a) => a.at > Date.now());
  reg.active?.postMessage({ type: 'schedule', alerts: upcoming });

  try {
    const old = await reg.getNotifications({ includeTriggered: false });
    old.filter((n) => n.tag.startsWith('reserve-')).forEach((n) => n.close());
  } catch {}
  if ('showTrigger' in Notification.prototype && 'TimestampTrigger' in window) {
    for (const a of upcoming) {
      try {
        await reg.showNotification(a.title, {
          body: a.body, tag: `reserve-${a.key}`, icon: 'icon-192.png', showTrigger: new TimestampTrigger(a.at),
        });
      } catch {}
    }
  }
  if (upcoming.length && 'periodicSync' in reg) {
    try { await reg.periodicSync.register('reserve-check', { minInterval: HOUR }); } catch {}
  }
}

function downloadICS() {
  const last = lastEventTs();
  const now = Date.now();
  // Next prime window: the current one if it hasn't ended, else 1 day from now (assumes a release today).
  let start = last != null ? last + 1 * DAY : now;
  let end = last != null ? last + 4 * DAY : now + 3 * DAY;
  if (end < now) { start = now + 1 * DAY; end = now + 4 * DAY; }
  start = Math.max(start, now);
  const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Reserve//EN', 'BEGIN:VEVENT',
    `UID:reserve-${start}@reserve`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    'SUMMARY:Prime window', 'DESCRIPTION:Best balance of sperm count and DNA quality.',
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Prime window open', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'reserve-prime-window.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------ */
let toastTimer = null;
let undoTs = null;

function commit() {
  state.events.sort((a, b) => a - b);
  store.save(state);
  render();
  scheduleAlerts();
}

function logRelease(t = Date.now()) {
  const before = levelAt('sperm', t);
  state.events.push(t);
  commit();
  undoTs = t;
  toast(`~${fmtSperm(before - levelAt('sperm', t))}M sperm released`);
  navigator.vibrate?.([12, 40, 18]);
  const cta = $('release');
  cta.classList.remove('fire');
  void cta.offsetWidth;
  cta.classList.add('fire');
}

function toast(text) {
  $('toastText').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}

function openSheet(open) {
  $('sheet').classList.toggle('open', open);
  $('sheet').setAttribute('aria-hidden', String(!open));
  $('backdrop').hidden = !open;
  if (open) {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    $('backdate').max = d.toISOString().slice(0, 16);
  }
}

function renderSteppers() {
  document.querySelectorAll('.stepper').forEach((s) => {
    s.querySelector('output').textContent = state[s.dataset.field].toFixed(Number(s.dataset.dp)) + s.dataset.unit;
  });
}

function render() {
  renderHero();
  renderChart();
  renderSteppers();
}

/* ------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------ */
$('release').addEventListener('click', () => logRelease());
$('undo').addEventListener('click', () => {
  const i = state.events.lastIndexOf(undoTs);
  if (i >= 0) state.events.splice(i, 1);
  $('toast').hidden = true;
  commit();
});

$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  rangeDays = Number(b.dataset.range);
  for (const x of $('range').children) x.setAttribute('aria-selected', String(x === b));
  renderChart();
});

const chartEl = $('chart');
chartEl.addEventListener('pointermove', onPointer);
chartEl.addEventListener('pointerdown', onPointer);
chartEl.addEventListener('pointerleave', hideTip);
chartEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(hideTip, 1600); });

$('openSettings').addEventListener('click', () => openSheet(true));
$('backdrop').addEventListener('click', () => openSheet(false));
document.querySelectorAll('[data-alert]').forEach((input) =>
  input.addEventListener('change', () => setAlert(input.dataset.alert, input.checked)),
);
$('ics').addEventListener('click', downloadICS);

document.querySelectorAll('.stepper').forEach((s) => {
  const { field } = s.dataset;
  const step = Number(s.dataset.step);
  const min = Number(s.dataset.min);
  const max = Number(s.dataset.max);
  s.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      const next = Math.round((state[field] + step * Number(b.dataset.dir)) * 10) / 10;
      state[field] = Math.min(max, Math.max(min, next));
      shownValue = null;
      commit();
    }),
  );
});

$('backdate').addEventListener('change', (e) => {
  const t = new Date(e.target.value).getTime();
  if (!Number.isFinite(t) || t > Date.now()) return;
  if (t < state.start) state.start = t - 10 * DAY; // assume rested before the earliest record
  logRelease(t);
  e.target.value = '';
  openSheet(false);
});

$('export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = 'reserve-data.json';
  a.click();
});

$('reset').addEventListener('click', () => {
  if (!confirm('Erase all logged releases?')) return;
  state = { ...defaults(), cap: state.cap, spermCap: state.spermCap, alerts: state.alerts };
  shownValue = null;
  commit();
  openSheet(false);
});

let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(renderChart);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); checkAlerts(); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', renderChart);

setInterval(() => { renderHero(); checkAlerts(); }, 30_000);
setInterval(renderChart, 5 * 60_000);

render();
updateAlertUI();
registerSW().then(() => { checkAlerts(); scheduleAlerts(); });
