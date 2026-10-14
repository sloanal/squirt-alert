// Reserve push server. One Durable Object holds each device's push subscription
// and its upcoming alerts, and uses an alarm to wake up exactly when the next
// alert is due. Safari home-screen apps can only show server-sent pushes, so
// this is what makes alerts arrive while the app is closed.

import { DurableObject } from 'cloudflare:workers';
import { generateVapidKeys, sendPush } from './webpush.js';

const MAX_DEVICES = 20;
const MAX_ALERTS = 10;

export class Hub extends DurableObject {
  async vapid() {
    let keys = await this.ctx.storage.get('vapid');
    if (!keys) {
      keys = await generateVapidKeys();
      await this.ctx.storage.put('vapid', keys);
    }
    return keys;
  }

  async devices() {
    return (await this.ctx.storage.get('devices')) || {};
  }

  async reschedule(devices) {
    const next = Math.min(...Object.values(devices).flatMap((d) => d.alerts.map((a) => a.at)));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/key') {
      return json({ publicKey: (await this.vapid()).publicKey });
    }
    if (req.method === 'POST' && url.pathname === '/sync') {
      const { id, subscription, alerts } = await req.json();
      if (typeof id !== 'string' || id.length > 64) return json({ error: 'bad id' }, 400);
      const devices = await this.devices();
      if (!subscription) {
        delete devices[id];
      } else {
        if (!/^https:\/\//.test(subscription.endpoint || '') || !subscription.keys?.p256dh || !subscription.keys?.auth) {
          return json({ error: 'bad subscription' }, 400);
        }
        if (!devices[id] && Object.keys(devices).length >= MAX_DEVICES) return json({ error: 'full' }, 429);
        const now = Date.now();
        devices[id] = {
          subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
          alerts: (Array.isArray(alerts) ? alerts : [])
            .filter((a) => Number.isFinite(a?.at) && a.at > now - 60_000)
            .slice(0, MAX_ALERTS)
            .map((a) => ({ key: String(a.key).slice(0, 80), at: a.at, title: String(a.title).slice(0, 80), body: String(a.body).slice(0, 200) })),
        };
      }
      await this.ctx.storage.put('devices', devices);
      await this.reschedule(devices);
      return json({ ok: true, scheduled: devices[id]?.alerts.length ?? 0 });
    }
    return json({ error: 'not found' }, 404);
  }

  async alarm() {
    const now = Date.now() + 5000;
    const devices = await this.devices();
    const vapid = await this.vapid();
    for (const [id, d] of Object.entries(devices)) {
      const due = d.alerts.filter((a) => a.at <= now).sort((a, b) => b.at - a.at);
      if (!due.length) continue;
      d.alerts = d.alerts.filter((a) => a.at > now);
      // Only the latest due alert, so a backlog never stacks.
      const a = due[0];
      try {
        const status = await sendPush(d.subscription, JSON.stringify({ title: a.title, body: a.body, tag: `reserve-${a.key}` }), vapid, this.env.VAPID_SUBJECT);
        if (status === 404 || status === 410) delete devices[id]; // subscription expired
        else if (status >= 400) console.log(`push ${id} failed: ${status}`);
      } catch (err) {
        console.log(`push ${id} error: ${err}`);
      }
    }
    await this.ctx.storage.put('devices', devices);
    await this.reschedule(devices);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (Number(req.headers.get('Content-Length') || 0) > 8192) return new Response('too large', { status: 413, headers: cors });

    const hub = env.HUB.get(env.HUB.idFromName('main'));
    const res = await hub.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
