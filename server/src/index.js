// Daily Tracker push server (Cloudflare Worker + D1).
// The app sends each device's reminder RULES (recurrence + local time + time zone). The server
// works out each rule's next fire time, and a cron trigger sends due reminders as Web Push
// messages, so reminders keep coming even if the app isn't opened for weeks.
import { b64urlEncode, b64urlDecode, utf8 } from './b64.js';
import { importVapidKeys, sendPush } from './webpush.js';
import { nextFire, isDateKey, isValidTimeZone } from './recur.js';

export const LIMITS = {
  maxRules: 500,
  maxDates: 400,              // exceptions / skipDates per rule
  newRuleGraceMs: 60000,      // a brand-new rule may fire for a time up to 1 min ago
  lateWindowMs: 15 * 60000,   // the cron sends reminders up to 15 min late (missed runs), never later
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

const RECUR_TYPES = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'interval'];
const dateList = (v, bad, name) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITS.maxDates || !v.every(isDateKey)) throw bad(`${name} must be a list of up to ${LIMITS.maxDates} YYYY-MM-DD dates`);
  return [...new Set(v)].sort();
};

/** Strictly validate a schedule { tz, rules }. Returns { tz, rules } cleaned. */
export function validateSchedule(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be an object');
  if (!isValidTimeZone(body.tz)) throw new HttpError(400, 'tz must be an IANA time zone');
  if (!Array.isArray(body.rules)) throw new HttpError(400, 'rules must be an array');
  if (body.rules.length > LIMITS.maxRules) throw new HttpError(400, `At most ${LIMITS.maxRules} rules`);
  const seen = new Set();
  const rules = body.rules.map((it, i) => {
    const bad = (m) => new HttpError(400, `rules[${i}]: ${m}`);
    if (!it || typeof it !== 'object') throw bad('must be an object');
    if (!isStr(it.id, 128, 1) || !/^[\w:.-]+$/.test(it.id)) throw bad('invalid id');
    if (seen.has(it.id)) throw bad('duplicate id');
    seen.add(it.id);
    if (!['task', 'habit'].includes(it.kind)) throw bad('kind must be task or habit');
    if (!isStr(it.title, 120, 1)) throw bad('title must be 1–120 characters');
    if (!isStr(it.body ?? '', 240)) throw bad('body must be at most 240 characters');
    const url = it.url ?? './';
    // Only same-app relative URLs (no other origins, no javascript:).
    if (!isStr(url, 300) || !/^(\.\/|\/(?!\/)|#)[^\s\\]*$/.test(url)) throw bad('url must be a relative app URL');
    if (!isStr(it.tag ?? '', 128)) throw bad('tag too long');
    if (typeof it.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.time)) throw bad('time must be HH:MM');
    const offsetDays = it.offsetDays ?? 0;
    if (!Number.isInteger(offsetDays) || offsetDays < -7 || offsetDays > 0) throw bad('offsetDays must be an integer from -7 to 0');
    const r = it.recur || { type: 'none' };
    if (!r || typeof r !== 'object' || !RECUR_TYPES.includes(r.type)) throw bad('invalid recur.type');
    const recur = { type: r.type };
    if (r.type === 'none') {
      if (!isDateKey(it.date)) throw bad('date (YYYY-MM-DD) is required for one-off rules');
    } else {
      if (!isDateKey(r.start)) throw bad('recur.start must be YYYY-MM-DD');
      recur.start = r.start;
      if (r.type === 'weekly') {
        const days = r.days ?? [];
        if (!Array.isArray(days) || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw bad('recur.days must be weekday numbers 0–6');
        recur.days = [...new Set(days)].sort();
      }
      if (r.type === 'interval') {
        if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 366) throw bad('recur.interval must be 1–366');
        recur.interval = r.interval;
      }
    }
    if (it.until !== undefined && it.until !== null && !isDateKey(it.until)) throw bad('until must be YYYY-MM-DD');
    return {
      id: it.id, kind: it.kind, title: it.title, body: it.body ?? '', url, tag: it.tag || it.id, time: it.time, offsetDays,
      recur, date: r.type === 'none' ? it.date : null, exceptions: dateList(it.exceptions, bad, 'exceptions'),
      skipDates: dateList(it.skipDates, bad, 'skipDates'), until: it.until || null,
    };
  });
  return { tz: body.tz, rules };
}

const fill = (tpl, date) => String(tpl).split('{date}').join(date);

/** Rule object as stored (definition JSON) → the shape nextFire() expects. */
const ruleFromRow = (row) => JSON.parse(row.def);

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
      'INSERT INTO devices (id, token_hash, endpoint, p256dh, auth, tz, created_at, updated_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, \'UTC\', ?6, ?6, ?6)',
    ).bind(deviceId, await sha256Hex(token), sub.endpoint, sub.p256dh, sub.auth, now).run();
    return json({ deviceId, token }, 201);
  }

  if (path === '/api/schedule' && request.method === 'PUT') {
    const id = await authDevice(request, env);
    await rateLimit(env, 'sch:' + id, LIMITS.rate.schedule, now);
    const { tz, rules } = validateSchedule(await readJson(request, LIMITS.scheduleBody));
    // Rules the device already had keep firing for occurrences missed in the last 15 minutes;
    // brand-new rules only fire from (about) now on. Occurrences already sent never repeat.
    const known = new Set((await env.DB.prepare('SELECT rule_id FROM rules WHERE device_id = ?1').bind(id).all()).results.map((r) => r.rule_id));
    const firedRows = (await env.DB.prepare('SELECT rule_id, date FROM fired WHERE device_id = ?1').bind(id).all()).results;
    const fired = new Map();
    for (const f of firedRows) (fired.get(f.rule_id) || fired.set(f.rule_id, new Set()).get(f.rule_id)).add(f.date);
    const stmts = [env.DB.prepare('DELETE FROM rules WHERE device_id = ?1').bind(id)];
    for (const r of rules) {
      const from = known.has(r.id) ? now - LIMITS.lateWindowMs : now - LIMITS.newRuleGraceMs;
      const next = nextFire(r, tz, from, { fired: fired.get(r.id) });
      stmts.push(env.DB.prepare('INSERT INTO rules (device_id, rule_id, def, next_at, next_date) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(id, r.id, JSON.stringify(r), next ? next.at : null, next ? next.date : null));
    }
    stmts.push(env.DB.prepare('UPDATE devices SET tz = ?2, last_seen = ?3 WHERE id = ?1').bind(id, tz, now));
    await env.DB.batch(stmts);
    return json({ ok: true, count: rules.length });
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

const deviceDeletes = (env, id) => ['rules', 'fired'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE device_id = ?1`).bind(id))
  .concat(env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(id));
async function deleteDevice(env, id) { await env.DB.batch(deviceDeletes(env, id)); }

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
/**
 * Send every rule occurrence due in (now − 15 min, now] that hasn't been sent, then move each
 * rule's next_at forward. Occurrences missed by more than 15 minutes are skipped, never sent late.
 */
export async function runCron(env, now = Date.now(), { fetchImpl = fetch } = {}) {
  const stats = { sent: 0, failed: 0, gone: 0, skippedLate: 0, purged: false };
  const { results } = await env.DB.prepare(
    `SELECT r.device_id, r.rule_id, r.def, r.next_at, r.next_date, d.tz, d.endpoint, d.p256dh, d.auth
       FROM rules r JOIN devices d ON d.id = r.device_id
      WHERE r.next_at IS NOT NULL AND r.next_at <= ?1
      ORDER BY r.next_at LIMIT ?2`,
  ).bind(now, LIMITS.sendBatch).all();
  if (results.length) {
    const toSend = results.filter((r) => r.next_at > now - LIMITS.lateWindowMs);
    stats.skippedLate = results.length - toSend.length;
    const deadDevices = new Set();
    if (toSend.length) {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
      const vapid = await importVapidKeys(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      const subject = env.VAPID_SUBJECT || 'mailto:admin@example.invalid';
      const authCache = new Map();
      let next = 0;
      const worker = async () => {
        while (next < toSend.length) {
          const r = toSend[next++];
          if (deadDevices.has(r.device_id)) continue;
          const rule = ruleFromRow(r);
          try {
            const res = await sendPush({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
              // url/tag are templates: "{date}" becomes the occurrence's local date (deep link to that day's item).
              { title: rule.title, body: rule.body, url: fill(rule.url, r.next_date), tag: fill(rule.tag, r.next_date) }, { vapid, subject, authCache, fetchImpl });
            if (res.gone) { deadDevices.add(r.device_id); stats.gone++; } else if (res.ok) stats.sent++; else stats.failed++;
          } catch (e) { stats.failed++; console.error('push failed', e?.message); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, toSend.length) }, worker));
    }
    // Every selected occurrence is done (sent, failed or too late): record it and move the rule on.
    // (A failed send isn't retried every minute: a reminder is time-bound.)
    const stmts = [];
    for (const r of results) {
      if (deadDevices.has(r.device_id)) continue;
      const rule = ruleFromRow(r);
      const nx = nextFire(rule, r.tz, Math.max(r.next_at, now - LIMITS.lateWindowMs), { fired: new Set([r.next_date]) });
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO fired (device_id, rule_id, date, at) VALUES (?1, ?2, ?3, ?4)').bind(r.device_id, r.rule_id, r.next_date, now),
        env.DB.prepare('UPDATE rules SET next_at = ?3, next_date = ?4 WHERE device_id = ?1 AND rule_id = ?2').bind(r.device_id, r.rule_id, nx ? nx.at : null, nx ? nx.date : null),
      );
    }
    for (const id of deadDevices) stmts.push(...deviceDeletes(env, id));
    if (stmts.length) await env.DB.batch(stmts);
  }
  // Daily purge (once a day at 03:00 UTC).
  const d = new Date(now);
  if (d.getUTCHours() === 3 && d.getUTCMinutes() === 0) { await purge(env, now); stats.purged = true; }
  return stats;
}

/** Old send records, devices not seen for 180 days (and their rules), old rate-limit rows. */
export async function purge(env, now = Date.now()) {
  const stale = now - 180 * 86400000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM fired WHERE at < ?1').bind(now - 3 * 86400000),
    env.DB.prepare('DELETE FROM rules WHERE device_id IN (SELECT id FROM devices WHERE last_seen < ?1)').bind(stale),
    env.DB.prepare('DELETE FROM fired WHERE device_id IN (SELECT id FROM devices WHERE last_seen < ?1)').bind(stale),
    env.DB.prepare('DELETE FROM devices WHERE last_seen < ?1').bind(stale),
    env.DB.prepare('DELETE FROM rate WHERE win < ?1').bind(Math.floor(now / 3600000) - 2),
  ]);
}

export default {
  fetch: (request, env) => handleFetch(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env, event.scheduledTime || Date.now())); },
};
