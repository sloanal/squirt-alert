'use strict';

/* ------------------------------------------------------------------
 * Model
 *
 * CAPACITY  ~3.0 mL: mean ejaculate volume reported for men aged 40–44
 *           (studies range ~2.5–3.4 mL).
 * DRAIN     a release empties ~90% of the current reserve.
 * TAU       refill time constant (days). Exponential refill toward
 *           capacity: ~50% at 1 day, ~85% at 3 days, ~98% at 6 days —
 *           consistent with seminal-vesicle MRI refill (~3 days) and
 *           abstinence studies (≈1.8 mL at day 1 → ≈3.5 mL at day 6+).
 * FULL      reserve counts as "full" at 95% of capacity.
 * ------------------------------------------------------------------ */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const DEFAULT_CAP = 3.0;
const DRAIN = 0.9;
const TAU = 1.64 * DAY;
const FULL = 0.95;
const KEY = 'reserve.v1';

const store = {
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.events)) return s;
    } catch {}
    return { cap: DEFAULT_CAP, start: Date.now(), events: [], notify: false, notifiedFor: null };
  },
  save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  },
};

let state = store.load();
if (state.notifiedFor == null) state.notifiedFor = lastEventTs();

function refill(level, dt) {
  return state.cap - (state.cap - level) * Math.exp(-Math.max(0, dt) / TAU);
}

function levelAt(t) {
  let level = state.cap;
  let prev = state.start;
  for (const e of state.events) {
    if (e > t) break;
    level = refill(level, e - prev) * (1 - DRAIN);
    prev = e;
  }
  return refill(level, t - prev);
}

function lastEventTs() {
  return state.events.length ? state.events[state.events.length - 1] : state.start;
}

/** Milliseconds from `t` until the reserve reaches FULL (0 if already full). */
function timeToFull(t = Date.now()) {
  const level = levelAt(t);
  const target = FULL * state.cap;
  if (level >= target) return 0;
  return TAU * Math.log((state.cap - level) / (state.cap - target));
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

/* ------------------------------------------------------------------
 * Hero + stats
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
let shownValue = null;

function renderHero() {
  const now = Date.now();
  const level = levelAt(now);
  const pct = level / state.cap;
  const ttf = timeToFull(now);
  const full = ttf === 0;

  tweenValue(level);
  $('meterFill').style.width = `${(pct * 100).toFixed(1)}%`;
  $('pct').textContent = `${Math.round(pct * 100)}% of ${state.cap.toFixed(1)} mL`;
  $('eta').textContent = full ? 'Ready' : `Full in ${fmtDuration(ttf)}`;

  const status = $('status');
  status.classList.toggle('full', full);
  status.textContent = full ? 'Full' : pct < 0.35 ? 'Recharging' : 'Refilling';

  // Stats
  const ev = state.events;
  $('statLast').textContent = ev.length ? `${fmtDuration(now - ev[ev.length - 1])} ago` : '—';
  $('statWeek').textContent = ev.filter((e) => e > now - 7 * DAY).length;
  if (ev.length >= 2) {
    const recent = ev.slice(-10);
    const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    $('statAvg').textContent = fmtDuration(avg);
  } else {
    $('statAvg').textContent = '—';
  }
}

function tweenValue(target) {
  const el = $('value');
  const from = shownValue ?? target;
  shownValue = target;
  if (Math.abs(from - target) < 0.005 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toFixed(2);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (target - from) * e).toFixed(2);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------
 * Chart (hand-rolled SVG line chart)
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

function buildSeries(from, to, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    pts.push([t, levelAt(t)]);
  }
  // Insert exact pre/post points at each release so drops are vertical.
  for (const e of state.events) {
    if (e > from && e <= to) {
      pts.push([e - 1, levelAt(e - 1)], [e, levelAt(e)]);
    }
  }
  return pts.sort((a, b) => a[0] - b[0]);
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

  const pad = { l: 30, r: 6, t: 26, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (t) => pad.l + ((t - left) / (right - left)) * iw;
  const y = (v) => pad.t + ih - (v / state.cap) * ih;
  geom = { x, y, left, right, dataLeft, pad, iw, W };

  const defs = el('defs', {}, svg);
  const lg = el('linearGradient', { id: 'lineGrad', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
  const cs = getComputedStyle(document.documentElement);
  el('stop', { offset: '0', 'stop-color': cs.getPropertyValue('--accent').trim() }, lg);
  el('stop', { offset: '1', 'stop-color': cs.getPropertyValue('--accent-2').trim() }, lg);
  const ag = el('linearGradient', { id: 'areaGrad', x1: '0', x2: '0', y1: '0', y2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': cs.getPropertyValue('--accent').trim(), 'stop-opacity': '0.22' }, ag);
  el('stop', { offset: '1', 'stop-color': cs.getPropertyValue('--accent').trim(), 'stop-opacity': '0' }, ag);

  // Grid + y labels
  for (const f of [0, 0.5, 1]) {
    const gy = y(f * state.cap);
    el('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: gy, y2: gy }, svg);
    const label = el('text', { class: 'axis', x: pad.l - 8, y: gy + 3, 'text-anchor': 'end' }, svg);
    label.textContent = (f * state.cap).toFixed(1);
  }

  // X ticks, aligned to local calendar boundaries
  const stepH = rangeDays === 1 ? 6 : rangeDays === 7 ? 48 : 24 * 7;
  const tick = new Date(left);
  tick.setMinutes(0, 0, 0);
  if (rangeDays === 1) tick.setHours(Math.ceil(tick.getHours() / 6) * 6);
  else { tick.setHours(24); }
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

  // History
  const hist = buildSeries(dataLeft, now, 220);
  const path = hist.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  el('path', { d: `${path}L${x(now)},${y(0)}L${x(dataLeft)},${y(0)}Z`, fill: 'url(#areaGrad)' }, svg);
  el('path', { class: 'line', d: path }, svg);

  // Projection
  const proj = buildSeries(now, right, 60);
  el('path', { class: 'proj', d: proj.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('') }, svg);

  // Release markers at the bottom of each drop
  for (const e of state.events) {
    if (e >= dataLeft && e <= now) el('circle', { class: 'event', cx: x(e), cy: y(levelAt(e)), r: 4 }, svg);
  }

  // Now marker
  const nv = levelAt(now);
  el('circle', { class: 'now-halo', cx: x(now), cy: y(nv), r: 10 }, svg);
  el('circle', { class: 'now-dot', cx: x(now), cy: y(nv), r: 5 }, svg);

  // Hover layer
  geom.cross = el('line', { class: 'cross', y1: pad.t, y2: pad.t + ih, visibility: 'hidden' }, svg);
  geom.crossDot = el('circle', { class: 'cross-dot', r: 5, visibility: 'hidden' }, svg);
}

function onPointer(ev) {
  if (!geom) return;
  const svg = $('chartSvg');
  const r = svg.getBoundingClientRect();
  const px = ev.clientX - r.left;
  const { left, right, dataLeft, pad, iw } = geom;
  let t = left + ((px - pad.l) / iw) * (right - left);
  t = Math.min(right, Math.max(dataLeft, t));
  const v = levelAt(t);
  const cx = geom.x(t);
  const cy = geom.y(v);
  geom.cross.setAttribute('x1', cx);
  geom.cross.setAttribute('x2', cx);
  geom.cross.setAttribute('visibility', 'visible');
  geom.crossDot.setAttribute('cx', cx);
  geom.crossDot.setAttribute('cy', cy);
  geom.crossDot.setAttribute('visibility', 'visible');

  const tip = $('tip');
  const future = t > Date.now();
  tip.innerHTML = `<b>${v.toFixed(2)} mL</b><span>${future ? 'Projected · ' : ''}${fmtDay(t)} ${fmtTime(t)}</span>`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(r.width - tw / 2, Math.max(tw / 2, cx))}px`;
  tip.style.top = `${Math.max(-8, cy - 46)}px`;
}

function hideTip() {
  if (!geom) return;
  $('tip').hidden = true;
  geom.cross?.setAttribute('visibility', 'hidden');
  geom.crossDot?.setAttribute('visibility', 'hidden');
}

/* ------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------ */
let swReg = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    return swReg;
  } catch {
    return null;
  }
}

function notifSupported() {
  return 'Notification' in window;
}

function updateNotifUI() {
  const sub = $('notifSub');
  const toggle = $('notifToggle');
  if (!notifSupported()) {
    toggle.disabled = true;
    sub.textContent = /iP(hone|ad)/.test(navigator.userAgent)
      ? 'On iPhone, use Share → Add to Home Screen first'
      : 'Not supported in this browser';
    return;
  }
  toggle.checked = state.notify && Notification.permission === 'granted';
  sub.textContent = Notification.permission === 'denied'
    ? 'Blocked — enable in system settings'
    : "Get notified when you're back to full";
}

async function setNotify(on) {
  if (on) {
    const perm = await Notification.requestPermission();
    state.notify = perm === 'granted';
  } else {
    state.notify = false;
  }
  store.save(state);
  updateNotifUI();
  scheduleNotifications();
}

async function showFullNotification() {
  const opts = {
    body: `Reserve is back to ${state.cap.toFixed(1)} mL.`,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'reserve-full',
  };
  try {
    const reg = swReg || (await navigator.serviceWorker?.ready);
    if (reg) return reg.showNotification('You’re full', opts);
  } catch {}
  try { new Notification('You’re full', opts); } catch {}
}

/** Fire once per refill cycle, the first time we observe the reserve at FULL. */
function checkFull() {
  const last = lastEventTs();
  if (!state.notify || state.notifiedFor === last) return;
  if (timeToFull() === 0) {
    state.notifiedFor = last;
    store.save(state);
    if (Notification.permission === 'granted') showFullNotification();
  }
}

/**
 * Hand the next "full" time to the service worker so it can alert while the
 * app is closed: via Notification Triggers where available, otherwise via
 * periodic background sync (installed PWAs on Chromium).
 */
async function scheduleNotifications() {
  const reg = swReg || (await navigator.serviceWorker?.ready.catch(() => null));
  if (!reg) return;
  const fullAt = Date.now() + timeToFull();
  const pending = state.notify && state.notifiedFor !== lastEventTs() ? fullAt : null;
  reg.active?.postMessage({ type: 'schedule', fullAt: pending, cap: state.cap });

  try {
    const old = await reg.getNotifications({ tag: 'reserve-full', includeTriggered: false });
    old.forEach((n) => n.close());
  } catch {}
  if (pending && 'showTrigger' in Notification.prototype && 'TimestampTrigger' in window) {
    try {
      await reg.showNotification('You’re full', {
        body: `Reserve is back to ${state.cap.toFixed(1)} mL.`,
        tag: 'reserve-full',
        icon: 'icon-192.png',
        showTrigger: new TimestampTrigger(fullAt),
      });
    } catch {}
  }
  if (state.notify && 'periodicSync' in reg) {
    try { await reg.periodicSync.register('reserve-check', { minInterval: HOUR }); } catch {}
  }
}

function downloadICS() {
  const fullAt = Date.now() + timeToFull();
  const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Reserve//EN', 'BEGIN:VEVENT',
    `UID:reserve-${fullAt}@reserve`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(fullAt)}`, `DTEND:${stamp(fullAt + 15 * 60000)}`,
    'SUMMARY:Reserve full', `DESCRIPTION:Back to ${state.cap.toFixed(1)} mL.`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Reserve full', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'reserve-full.ics';
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
  scheduleNotifications();
}

function logRelease(t = Date.now()) {
  const before = levelAt(t);
  state.events.push(t);
  commit();
  const after = levelAt(t);
  undoTs = t;
  toast(`−${(before - after).toFixed(2)} mL logged`);
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

function render() {
  renderHero();
  renderChart();
  $('capOut').textContent = state.cap.toFixed(1);
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
$('notifToggle').addEventListener('change', (e) => setNotify(e.target.checked));
$('ics').addEventListener('click', downloadICS);

document.querySelectorAll('.stepper button').forEach((b) =>
  b.addEventListener('click', () => {
    const next = Math.round((state.cap + Number(b.dataset.step)) * 10) / 10;
    state.cap = Math.min(8, Math.max(0.5, next));
    commit();
  }),
);

$('backdate').addEventListener('change', (e) => {
  const t = new Date(e.target.value).getTime();
  if (!Number.isFinite(t) || t > Date.now()) return;
  if (t < state.start) state.start = t - 6 * DAY; // assume full before the earliest record
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
  state = { cap: state.cap, start: Date.now(), events: [], notify: state.notify, notifiedFor: null };
  state.notifiedFor = state.start;
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
  if (!document.hidden) { render(); checkFull(); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', renderChart);

setInterval(() => { renderHero(); checkFull(); }, 30_000);
setInterval(renderChart, 5 * 60_000);

render();
updateNotifUI();
registerSW().then(() => { checkFull(); scheduleNotifications(); });
