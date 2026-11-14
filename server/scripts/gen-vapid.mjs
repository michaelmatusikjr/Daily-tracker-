// Prints a fresh VAPID key pair (base64url). Keep the private key secret:
//   npx wrangler secret put VAPID_PRIVATE_KEY   (paste it when asked)
import { webcrypto as crypto } from 'node:crypto';
import { b64urlEncode, b64urlDecode } from '../src/b64.js';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = new Uint8Array([4, ...b64urlDecode(jwk.x), ...b64urlDecode(jwk.y)]);
console.log('VAPID_PUBLIC_KEY  (put in wrangler.toml [vars] and in the app):');
console.log(b64urlEncode(pub));
console.log('\nVAPID_PRIVATE_KEY (secret! run: npx wrangler secret put VAPID_PRIVATE_KEY):');
console.log(jwk.d);
