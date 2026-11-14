// End-to-end tests of the Worker in Miniflare (workerd + local D1): endpoints, auth, CORS,
// validation, rate limits, and the cron sender (with a fake push service that decrypts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Miniflare } from 'miniflare';
import { b64urlEncode } from '../src/b64.js';

const require = createRequire(import.meta.url);
const webpush = require('web-push');
const ece = require(require.resolve('http_ece', { paths: [require.resolve('web-push')] }));

const ORIGIN = 'https://app.example.org';
const vapid = webpush.generateVAPIDKeys();
const pushed = [];        // requests received by the fake push service
let pushStatus = 201;     // what the fake push service answers
let mf;

const receivers = new Map();
function subscription(name) {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `https://push.example.net/send/${name}`;
  receivers.set(endpoint, { ua, auth });
  return { endpoint, keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) } };
}

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    scriptPath: new URL('../src/index.js', import.meta.url).pathname,
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    bindings: { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.com', ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8080` },
    // Every outbound fetch from the Worker lands here: a fake push service.
    outboundService: async (req) => {
      const body = Buffer.from(await req.arrayBuffer());
      const r = receivers.get(req.url);
      const text = r ? ece.decrypt(body, { version: 'aes128gcm', privateKey: r.ua, authSecret: r.auth }).toString() : null;
      pushed.push({ url: req.url, headers: Object.fromEntries(req.headers), payload: text && JSON.parse(text) });
      return new Response(null, { status: pushStatus });
    },
  });
  const db = await mf.getD1Database('DB');
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
});
after(async () => { await mf?.dispose(); });

const call = (method, path, { body, token, device, origin = ORIGIN, headers = {} } = {}) => mf.dispatchFetch('https://push.local' + path, {
  method,
  headers: {
    ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token, 'X-Device': device } : {}), ...headers,
  },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const cron = async (time) => { const w = await mf.getWorker(); return w.scheduled({ scheduledTime: new Date(time), cron: '* * * * *' }); };
async function register(name, ip = '1.1.1.1') {
  const res = await call('POST', '/api/register', { body: { subscription: subscription(name) }, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(res.status, 201);
  return res.json();
}
const item = (id, at, extra = {}) => ({ id, at, title: 'Title ' + id, body: 'Body', url: './#today/2026-11-20', tag: id, ...extra });

test('health, CORS and origin checks', async () => {
  const h = await call('GET', '/api/health', { origin: null });
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  const pre = await call('OPTIONS', '/api/schedule');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Device/);
  assert.equal((await call('OPTIONS', '/api/schedule', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/register', { origin: 'https://evil.example', body: {} })).status, 403);
  assert.equal((await call('POST', '/api/register', { origin: null, body: {} })).status, 403);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('register validates the subscription and returns id + token (only a hash is stored)', async () => {
  assert.equal((await call('POST', '/api/register', { body: { subscription: { endpoint: 'http://insecure/x', keys: {} } } })).status, 400);
  assert.equal((await call('POST', '/api/register', { body: '{bad json' })).status, 400);
  assert.equal((await call('POST', '/api/register', { body: { subscription: subscription('big'), pad: 'x'.repeat(9000) } })).status, 413);
  const { deviceId, token } = await register('a');
  assert.match(deviceId, /^[A-Za-z0-9_-]{22}$/); // 128 bits
  assert.ok(token.length >= 40);
  const db = await mf.getD1Database('DB');
  const row = await db.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceId).first();
  assert.equal(row.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(row).includes(token));
});

test('schedule: auth, strict validation, replace semantics', async () => {
  const { deviceId, token } = await register('b');
  const now = Date.now();
  assert.equal((await call('PUT', '/api/schedule', { body: { items: [] } })).status, 401);
  assert.equal((await call('PUT', '/api/schedule', { body: { items: [] }, token: 'x'.repeat(43), device: deviceId })).status, 401);
  const bad = async (items, why) => assert.equal((await call('PUT', '/api/schedule', { body: { items }, token, device: deviceId })).status, 400, why);
  await bad([item('a', now - 3600000)], 'past');
  await bad([item('a', now + 61 * 86400000)], 'too far ahead');
  await bad([item('a', now + 1000, { url: 'https://evil.example/' })], 'absolute url');
  await bad([item('a', now + 1000, { url: '//evil.example/' })], 'protocol-relative url');
  await bad([item('a', now + 1000, { url: 'javascript:alert(1)' })], 'javascript url');
  await bad([item('a', now + 1000, { title: '' })], 'empty title');
  await bad([item('a', now + 1000, { title: 'x'.repeat(121) })], 'long title');
  await bad([item('a b', now + 1000)], 'bad id');
  await bad([item('a', now + 1000), item('a', now + 2000)], 'duplicate id');
  await bad([item('a', 1.5)], 'non-integer at');
  await bad(Array.from({ length: 501 }, (_, i) => item('i' + i, now + 60000)), 'too many');
  let res = await call('PUT', '/api/schedule', { body: { items: [item('one', now + 60000), item('two', now + 120000)] }, token, device: deviceId });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  res = await call('PUT', '/api/schedule', { body: { items: [item('two', now + 180000)] }, token, device: deviceId });
  assert.equal((await res.json()).count, 1);
  const db = await mf.getD1Database('DB');
  const rows = (await db.prepare('SELECT item_id, at FROM items WHERE device_id = ?').bind(deviceId).all()).results;
  assert.deepEqual(rows.map((r) => [r.item_id, r.at]), [['two', now + 180000]], 'whole schedule replaced');
  res = await call('PUT', '/api/schedule', { body: { items: Array.from({ length: 500 }, (_, i) => item('i' + i, now + 60000 + i)) }, token, device: deviceId });
  assert.equal(res.status, 200, '500 items accepted');
});

test('cron sends due items once, skips late ones, and drops dead devices', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare('DELETE FROM items').run();
  const a = await register('c1');
  const b = await register('c2');
  const now = Date.now();
  const put = (d, items) => call('PUT', '/api/schedule', { body: { items }, token: d.token, device: d.deviceId });
  await put(a, [item('due', now + 60000), item('later', now + 3600000), item('soon', now + 30000)]);
  await put(b, [item('due-b', now + 60000)]);
  pushed.length = 0;
  await cron(now + 61000);
  assert.deepEqual(pushed.map((p) => p.payload.title).sort(), ['Title due', 'Title due-b', 'Title soon']);
  const p = pushed.find((x) => x.payload.title === 'Title due');
  assert.deepEqual(p.payload, { title: 'Title due', body: 'Body', url: './#today/2026-11-20', tag: 'due' });
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  assert.match(p.headers.authorization, /^vapid t=.+, k=/);
  pushed.length = 0;
  await cron(now + 62000);
  assert.equal(pushed.length, 0, 'not sent twice');
  // Re-syncing a schedule that still contains a sent item does not re-send it.
  await put(a, [item('due', now + 60000), item('later', now + 3600000)]);
  await cron(now + 63000);
  assert.equal(pushed.length, 0, 're-sync does not resurrect sent items');
  // Late items (cron missed for > 15 minutes) are dropped, not sent hours later.
  await cron(now + 3600000 + 16 * 60000);
  assert.equal(pushed.length, 0, 'late item not sent');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM items WHERE item_id = 'later'").first()).n, 0, 'late item removed');
  // 410 from the push service removes the device and its items.
  await put(b, [item('x', now + 120000)]);
  pushStatus = 410;
  await cron(now + 121000);
  pushStatus = 201;
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM devices WHERE id = ?').bind(b.deviceId).first()).n, 0);
  assert.equal((await call('PUT', '/api/schedule', { body: { items: [] }, token: b.token, device: b.deviceId })).status, 401);
});

test('cron sends at most one batch per run', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare('DELETE FROM items').run();
  const d = await register('batch', '9.9.9.9');
  const now = Date.now();
  await call('PUT', '/api/schedule', { body: { items: Array.from({ length: 250 }, (_, i) => item('b' + i, now + 60000)) }, token: d.token, device: d.deviceId });
  pushed.length = 0;
  await cron(now + 61000);
  assert.equal(pushed.length, 200);
  await cron(now + 62000);
  assert.equal(pushed.length, 250);
});

test('subscription update and device delete', async () => {
  const d = await register('rot');
  const fresh = subscription('rot2');
  assert.equal((await call('POST', '/api/subscription', { body: { subscription: fresh }, token: d.token, device: d.deviceId })).status, 200);
  const db = await mf.getD1Database('DB');
  assert.equal((await db.prepare('SELECT endpoint FROM devices WHERE id = ?').bind(d.deviceId).first()).endpoint, fresh.endpoint);
  await call('PUT', '/api/schedule', { body: { items: [item('z', Date.now() + 60000)] }, token: d.token, device: d.deviceId });
  assert.equal((await call('DELETE', '/api/device', { token: d.token, device: d.deviceId })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM items WHERE device_id = ?').bind(d.deviceId).first()).n, 0);
  assert.equal((await call('DELETE', '/api/device', { token: d.token, device: d.deviceId })).status, 401);
});

test('daily purge removes old sent rows and stale devices', async () => {
  const db = await mf.getD1Database('DB');
  const d = await register('old', '8.8.8.8');
  const now = Date.now();
  await db.prepare("INSERT INTO items (device_id, item_id, at, title, body, url, tag, sent_at) VALUES (?, 'old', ?, 't', '', './', 'old', ?)").bind(d.deviceId, now - 5 * 86400000, now - 5 * 86400000).run();
  await db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now - 90 * 86400000, d.deviceId).run();
  const at3 = new Date(now); at3.setUTCHours(3, 0, 0, 0);
  await cron(at3.getTime() + (at3.getTime() < now ? 86400000 : 0));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM items WHERE device_id = ?').bind(d.deviceId).first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM devices WHERE id = ?').bind(d.deviceId).first()).n, 0);
});

test('rate limits: register per IP', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/register', { body: { subscription: subscription('rl' + i) }, headers: { 'CF-Connecting-IP': '7.7.7.7' } });
  assert.equal(last.status, 429);
  assert.equal((await call('POST', '/api/register', { body: { subscription: subscription('rl-other') }, headers: { 'CF-Connecting-IP': '6.6.6.6' } })).status, 201);
});
