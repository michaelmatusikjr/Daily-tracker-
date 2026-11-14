// Web Push for Cloudflare Workers using only WebCrypto:
//  - VAPID (RFC 8292): ES256-signed JWT in "Authorization: vapid t=…, k=…"
//  - Message encryption (RFC 8291) with the aes128gcm content coding (RFC 8188), one record.
import { b64urlEncode, b64urlDecode, utf8, concat } from './b64.js';

const subtle = () => crypto.subtle;
const RECORD_SIZE = 4096;

async function hkdf(salt, ikm, info, length) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * Encrypt `payload` (Uint8Array) for a subscription's keys (p256dh, auth: base64url).
 * Returns the aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext.
 * `opts.salt` / `opts.asKeyPair` exist only so tests can make the output deterministic.
 */
export async function encryptPayload(payload, { p256dh, auth }, opts = {}) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh key');
  if (authSecret.length !== 16) throw new Error('invalid auth secret');
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error('payload too large');
  const asKeys = opts.asKeyPair || await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle().exportKey('raw', asKeys.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public, 32)
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Single (last) record: plaintext followed by the 0x02 delimiter, no padding.
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ct);
}

/** Import the VAPID key pair (base64url: raw 65-byte public key, 32-byte private scalar). */
export async function importVapidKeys(publicKey, privateKey) {
  const pub = b64urlDecode(publicKey);
  const d = b64urlDecode(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('invalid VAPID keys');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)), d: b64urlEncode(d), ext: true };
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, publicKey: b64urlEncode(pub) };
}

/** VAPID Authorization header value for one push service origin. */
export async function vapidAuth(endpoint, { key, publicKey }, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64urlEncode(utf8(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: nowSec + 12 * 3600, sub: subject })}`;
  // WebCrypto ECDSA signatures are already raw r||s (64 bytes), which is what JWS ES256 wants.
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${publicKey}`;
}

/**
 * Send one push. Returns { status, ok, gone } where gone means the subscription is dead (404/410).
 * `vapid` = result of importVapidKeys; `authCache` (Map) reuses JWTs per push-service origin.
 */
export async function sendPush(sub, payloadObj, { vapid, subject, ttl = 1800, urgency = 'high', authCache = null, fetchImpl = fetch }) {
  const body = await encryptPayload(utf8(JSON.stringify(payloadObj)), sub);
  const origin = new URL(sub.endpoint).origin;
  let authorization = authCache?.get(origin);
  if (!authorization) { authorization = await vapidAuth(sub.endpoint, vapid, subject); authCache?.set(origin, authorization); }
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization, TTL: String(ttl), Urgency: urgency,
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    },
    body,
  });
  return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
}
