// Web Push crypto, checked against the reference implementation used by the `web-push`
// npm package (`http_ece`, RFC 8188/8291) and against Node's own ECDSA verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { encryptPayload, importVapidKeys, vapidAuth, sendPush } from '../src/webpush.js';
import { b64urlEncode, b64urlDecode, utf8 } from '../src/b64.js';

const require = createRequire(import.meta.url);
const webpush = require('web-push');
const ece = require(require.resolve('http_ece', { paths: [require.resolve('web-push')] }));

/** A browser-side subscription: receiver ECDH key pair + auth secret. */
function makeReceiver() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) }, auth };
}
const decryptRef = (body, r) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: r.ua, authSecret: r.auth }).toString('utf8');

test('our ciphertext decrypts with the reference implementation (many sizes)', async () => {
  for (const size of [0, 1, 15, 16, 17, 100, 1000, 3000]) {
    const r = makeReceiver();
    const msg = 'x'.repeat(size) + (size ? '✓' : '');
    const body = await encryptPayload(utf8(msg), r.keys);
    assert.equal(decryptRef(body, r), msg, `size ${size}`);
  }
});

test('byte-identical to the reference encryption for the same ephemeral key and salt', async () => {
  const r = makeReceiver();
  const as = crypto.createECDH('prime256v1');
  as.generateKeys();
  const salt = crypto.randomBytes(16);
  const payload = utf8(JSON.stringify({ title: 'Gym', body: 'Starts at 6:00 PM', url: './#today/2026-11-20' }));
  const ref = ece.encrypt(Buffer.from(payload), { version: 'aes128gcm', dh: r.ua.getPublicKey(), privateKey: as, salt, authSecret: r.auth });
  // Import the same ephemeral key into WebCrypto.
  const pub = as.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)), d: b64urlEncode(as.getPrivateKey()) };
  const privateKey = await crypto.webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.webcrypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const ours = await encryptPayload(payload, r.keys, { salt: new Uint8Array(salt), asKeyPair: { privateKey, publicKey } });
  assert.equal(Buffer.from(ours).toString('hex'), Buffer.from(ref).toString('hex'));
});

test('web-push (reference) output for a subscription is readable with the same keys we use', async () => {
  const r = makeReceiver();
  const out = webpush.encrypt(r.keys.p256dh, r.keys.auth, 'hello from web-push', 'aes128gcm');
  assert.equal(decryptRef(out.cipherText, r), 'hello from web-push');
});

test('rejects bad subscription keys and oversized payloads', async () => {
  const r = makeReceiver();
  await assert.rejects(encryptPayload(utf8('x'), { p256dh: 'AAAA', auth: r.keys.auth }));
  await assert.rejects(encryptPayload(utf8('x'), { p256dh: r.keys.p256dh, auth: 'AAAA' }));
  await assert.rejects(encryptPayload(new Uint8Array(4000), r.keys));
});

test('VAPID JWT is a valid ES256 signature with the right claims and header format', async () => {
  const keys = webpush.generateVAPIDKeys(); // reference key generator
  const vapid = await importVapidKeys(keys.publicKey, keys.privateKey);
  const now = 1_800_000_000;
  const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vapid, 'mailto:test@example.com', now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[2], keys.publicKey);
  const [h, p, s] = m[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(b64urlDecode(h)).toString()), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(b64urlDecode(p)).toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: 'mailto:test@example.com' });
  const pub = b64urlDecode(keys.publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlDecode(s))));
  // Same shape as the reference library's header for aes128gcm.
  const ref = webpush.getVapidHeaders('https://fcm.googleapis.com', 'mailto:test@example.com', keys.publicKey, keys.privateKey, 'aes128gcm');
  assert.match(ref.Authorization, /^vapid t=[^,]+, k=/);
});

test('sendPush posts an encrypted body with the Web Push headers', async () => {
  const keys = webpush.generateVAPIDKeys();
  const vapid = await importVapidKeys(keys.publicKey, keys.privateKey);
  const r = makeReceiver();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }); };
  const authCache = new Map();
  const sub = { endpoint: 'https://push.example.net/s/1', ...r.keys };
  const res = await sendPush(sub, { title: 'T', body: 'B', url: './', tag: 'x' }, { vapid, subject: 'mailto:a@b.c', fetchImpl, authCache });
  await sendPush(sub, { title: 'T2' }, { vapid, subject: 'mailto:a@b.c', fetchImpl, authCache });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, sub.endpoint);
  const hdr = calls[0].init.headers;
  assert.equal(hdr['Content-Encoding'], 'aes128gcm');
  assert.equal(hdr.TTL, '1800');
  assert.equal(hdr.Authorization, calls[1].init.headers.Authorization, 'JWT reused per origin');
  assert.deepEqual(JSON.parse(decryptRef(calls[0].init.body, r)), { title: 'T', body: 'B', url: './', tag: 'x' });
  const gone = await sendPush(sub, { title: 'x' }, { vapid, subject: 'mailto:a@b.c', fetchImpl: async () => new Response(null, { status: 410 }) });
  assert.equal(gone.gone, true);
});

test('gen-vapid keys work with the reference library', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [new URL('../scripts/gen-vapid.mjs', import.meta.url).pathname]).toString();
  const [pub, priv] = out.split('\n').filter((l) => /^[A-Za-z0-9_-]{40,}$/.test(l));
  assert.equal(b64urlDecode(pub).length, 65);
  assert.equal(b64urlDecode(priv).length, 32);
  webpush.setVapidDetails('mailto:a@b.c', pub, priv); // throws on invalid keys
  await importVapidKeys(pub, priv);
});
