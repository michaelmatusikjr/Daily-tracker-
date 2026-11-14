// Daily Tracker push server (Cloudflare Worker + D1).
// The app sends each device's upcoming reminders; a cron trigger sends them as Web Push messages.
import { b64urlEncode, b64urlDecode, utf8 } from './b64.js';
import { importVapidKeys, sendPush } from './webpush.js';

export const LIMITS = {
  maxItems: 500,
  maxAheadMs: 60 * 86400000,
  pastGraceMs: 5 * 60000,     // items slightly in the past are accepted (clock skew) …
  lateWindowMs: 15 * 60000,   // … and the cron still sends items up to 15 min late, never later
  scheduleBody: 256 * 1024,
  smallBody: 8 * 1024,
  sendBatch: 200,             // pushes per cron run (free-tier CPU friendly)
  concurrency: 6,
  rate: { register: 10, schedule: 120, subscription: 30 }, // per hour (register: per IP; others: per device)
};

// ---------- HTTP helpers ----------
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (status, message, headers) => json({ error: message }, status, headers);

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(request, max) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > max) throw new HttpError(413, 'Request too large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(413, 'Request too large');
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function sha256Hex(str) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(str)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const randomId = (bytes) => b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

// ---------- Validation ----------
const isStr = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;

export function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') throw new HttpError(400, 'subscription is required');
  const { endpoint, keys } = sub;
  if (!isStr(endpoint, 1024, 10)) throw new HttpError(400, 'Invalid endpoint');
  let u;
  try { u = new URL(endpoint); } catch { throw new HttpError(400, 'Invalid endpoint'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'Endpoint must be https');
  if (!keys || !isStr(keys.p256dh, 200, 80) || !isStr(keys.auth, 50, 16)) throw new HttpError(400, 'Invalid subscription keys');
  try {
    const p = b64urlDecode(keys.p256dh), a = b64urlDecode(keys.auth);
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) throw new Error();
  } catch { throw new HttpError(400, 'Invalid subscription keys'); }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** Strictly validate a schedule. Returns the cleaned items. */
export function validateSchedule(body, now = Date.now()) {
  if (!body || !Array.isArray(body.items)) throw new HttpError(400, 'items must be an array');
  if (body.items.length > LIMITS.maxItems) throw new HttpError(400, `At most ${LIMITS.maxItems} items`);
  const seen = new Set();
  return body.items.map((it, i) => {
    const bad = (m) => new HttpError(400, `items[${i}]: ${m}`);
    if (!it || typeof it !== 'object') throw bad('must be an object');
    if (!isStr(it.id, 128, 1) || !/^[\w:.-]+$/.test(it.id)) throw bad('invalid id');
    if (seen.has(it.id)) throw bad('duplicate id');
    seen.add(it.id);
    if (!Number.isSafeInteger(it.at)) throw bad('at must be an integer (UTC ms)');
    if (it.at < now - LIMITS.pastGraceMs || it.at > now + LIMITS.maxAheadMs) throw bad('at is out of range');
    if (!isStr(it.title, 120, 1)) throw bad('title must be 1–120 characters');
    if (!isStr(it.body ?? '', 240)) throw bad('body must be at most 240 characters');
    const url = it.url ?? './';
    // Only same-app relative URLs (no other origins, no javascript:).
    if (!isStr(url, 300) || !/^(\.\/|\/(?!\/)|#)[^\s\\]*$/.test(url)) throw bad('url must be a relative app URL');
    if (!isStr(it.tag ?? '', 128)) throw bad('tag too long');
    return { id: it.id, at: it.at, title: it.title, body: it.body ?? '', url, tag: it.tag || it.id };
  });
}

// ---------- Rate limiting (fixed one-hour windows in D1) ----------
async function rateLimit(env, key, limit, now) {
  const win = Math.floor(now / 3600000);
  const row = await env.DB.prepare(
    `INSERT INTO rate (key, win, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate.win = ?2 THEN rate.count + 1 ELSE 1 END, win = ?2
     RETURNING count`,
  ).bind(key, win).first();
  if (row && row.count > limit) throw new HttpError(429, 'Too many requests, try again later');
}

// ---------- Auth ----------
async function authDevice(request, env) {
  const id = request.headers.get('X-Device') || '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') || '');
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id) || !m) throw new HttpError(401, 'Missing credentials');
  const row = await env.DB.prepare('SELECT id, token_hash FROM devices WHERE id = ?1').bind(id).first();
  if (!row || !timingSafeEqual(row.token_hash, await sha256Hex(m[1]))) throw new HttpError(401, 'Unknown device or bad token');
  return id;
}

// ---------- Routes ----------
async function route(request, env, now) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';

  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, time: now, vapid: !!env.VAPID_PUBLIC_KEY });
  }

  if (path === '/api/register' && request.method === 'POST') {
    await rateLimit(env, 'reg:' + ip, LIMITS.rate.register, now);
    const body = await readJson(request, LIMITS.smallBody);
    const sub = validateSubscription(body.subscription);
    const deviceId = randomId(16); // 128-bit
    const token = randomId(32);
    await env.DB.prepare(
      'INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, created_at, updated_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)',
    ).bind(deviceId, await sha256Hex(token), sub.endpoint, sub.p256dh, sub.auth, now).run();
    return json({ deviceId, token }, 201);
  }

  if (path === '/api/schedule' && request.method === 'PUT') {
    const id = await authDevice(request, env);
    await rateLimit(env, 'sch:' + id, LIMITS.rate.schedule, now);
    const items = validateSchedule(await readJson(request, LIMITS.scheduleBody), now);
    // Replace the pending schedule. Items already sent keep their row (so a re-sync never re-sends them).
    const stmts = [env.DB.prepare('DELETE FROM items WHERE device_id = ?1 AND sent_at IS NULL').bind(id)];
    for (const it of items) {
      stmts.push(env.DB.prepare(
        `INSERT INTO items (device_id, item_id, at, title, body, url, tag) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(device_id, item_id) DO NOTHING`,
      ).bind(id, it.id, it.at, it.title, it.body, it.url, it.tag));
    }
    stmts.push(env.DB.prepare('UPDATE devices SET last_seen = ?2 WHERE id = ?1').bind(id, now));
    await env.DB.batch(stmts);
    return json({ ok: true, count: items.length });
  }

  if (path === '/api/subscription' && request.method === 'POST') {
    const id = await authDevice(request, env);
    await rateLimit(env, 'sub:' + id, LIMITS.rate.subscription, now);
    const sub = validateSubscription((await readJson(request, LIMITS.smallBody)).subscription);
    await env.DB.prepare('UPDATE devices SET endpoint = ?2, p256dh = ?3, auth = ?4, updated_at = ?5, last_seen = ?5 WHERE id = ?1')
      .bind(id, sub.endpoint, sub.p256dh, sub.auth, now).run();
    return json({ ok: true });
  }

  if (path === '/api/device' && request.method === 'DELETE') {
    const id = await authDevice(request, env);
    await deleteDevice(env, id);
    return json({ ok: true });
  }

  return err(404, 'Not found');
}

async function deleteDevice(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE device_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(id),
  ]);
}

export async function handleFetch(request, env, now = Date.now()) {
  const origin = (request.headers.get('Origin') || '').replace(/\/+$/, '');
  const allowed = allowedOrigins(env);
  const okOrigin = origin && allowed.includes(origin);
  const cors = okOrigin ? corsHeaders(origin) : {};
  const isHealth = new URL(request.url).pathname.replace(/\/+$/, '') === '/api/health';
  if (request.method === 'OPTIONS') return okOrigin ? new Response(null, { status: 204, headers: cors }) : err(403, 'Origin not allowed');
  // Browsers always send Origin on these cross-origin calls; anything else is refused (health is open).
  if (!okOrigin && !isHealth) return err(403, 'Origin not allowed');
  try {
    const res = await route(request, env, now);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message, cors);
    console.error(e);
    return err(500, 'Server error', cors);
  }
}

// ---------- Cron ----------
/** Send due items (at <= now, not older than the late window), mark them sent, drop dead devices. */
export async function runCron(env, now = Date.now(), { fetchImpl = fetch } = {}) {
  const stats = { sent: 0, failed: 0, gone: 0, expired: 0, purged: false };
  // Items that were missed by more than the late window are dropped, never sent late.
  const exp = await env.DB.prepare('DELETE FROM items WHERE sent_at IS NULL AND at < ?1').bind(now - LIMITS.lateWindowMs).run();
  stats.expired = exp.meta?.changes || 0;
  const { results } = await env.DB.prepare(
    `SELECT i.device_id, i.item_id, i.title, i.body, i.url, i.tag, d.endpoint, d.p256dh, d.auth
       FROM items i JOIN devices d ON d.id = i.device_id
      WHERE i.sent_at IS NULL AND i.at <= ?1 AND i.at >= ?2
      ORDER BY i.at LIMIT ?3`,
  ).bind(now, now - LIMITS.lateWindowMs, LIMITS.sendBatch).all();
  if (results.length) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
    const vapid = await importVapidKeys(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const subject = env.VAPID_SUBJECT || 'mailto:admin@example.invalid';
    const authCache = new Map();
    const deadDevices = new Set();
    const sentRows = [];
    let next = 0;
    const worker = async () => {
      while (next < results.length) {
        const r = results[next++];
        if (deadDevices.has(r.device_id)) continue;
        try {
          const res = await sendPush({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
            { title: r.title, body: r.body, url: r.url, tag: r.tag }, { vapid, subject, authCache, fetchImpl });
          if (res.gone) { deadDevices.add(r.device_id); stats.gone++; }
          else if (res.ok) { sentRows.push(r); stats.sent++; }
          else { stats.failed++; sentRows.push(r); } // don't retry every minute; a reminder is time-bound
        } catch (e) {
          stats.failed++; sentRows.push(r);
          console.error('push failed', e?.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, results.length) }, worker));
    const stmts = sentRows.map((r) => env.DB.prepare('UPDATE items SET sent_at = ?3 WHERE device_id = ?1 AND item_id = ?2').bind(r.device_id, r.item_id, now));
    for (const id of deadDevices) {
      stmts.push(env.DB.prepare('DELETE FROM items WHERE device_id = ?1').bind(id), env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(id));
    }
    if (stmts.length) await env.DB.batch(stmts);
  }
  // Daily purge (once a day at 03:00 UTC): old sent rows, stale devices, old rate-limit rows.
  const d = new Date(now);
  if (d.getUTCHours() === 3 && d.getUTCMinutes() === 0) { await purge(env, now); stats.purged = true; }
  return stats;
}

export async function purge(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE sent_at IS NOT NULL AND sent_at < ?1').bind(now - 2 * 86400000),
    env.DB.prepare('DELETE FROM items WHERE device_id IN (SELECT id FROM devices WHERE last_seen < ?1)').bind(now - 60 * 86400000),
    env.DB.prepare('DELETE FROM devices WHERE last_seen < ?1').bind(now - 60 * 86400000),
    env.DB.prepare('DELETE FROM rate WHERE win < ?1').bind(Math.floor(now / 3600000) - 2),
  ]);
}

export default {
  fetch: (request, env) => handleFetch(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env, event.scheduledTime || Date.now())); },
};
