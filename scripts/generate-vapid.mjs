// Generates a VAPID key pair (P-256) in the base64url raw format that
// @block65/webcrypto-web-push expects:
//   publicKey  = base64url( 0x04 || X(32) || Y(32) )   (65 bytes)
//   privateKey = base64url( d )                          (the JWK 'd' scalar)
//
// Usage: node scripts/generate-vapid.mjs
// Copy the printed lines into .dev.vars (local) and use `wrangler secret put`
// for production. Generate ONCE and keep the keys stable.

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = Buffer.from(b64, 'base64')
  return new Uint8Array(bin)
}
function bytesToB64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

const kp = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey)

const x = b64urlToBytes(pubJwk.x)
const y = b64urlToBytes(pubJwk.y)
const raw = new Uint8Array(65)
raw[0] = 0x04
raw.set(x, 1)
raw.set(y, 33)

const publicKey = bytesToB64url(raw)
const privateKey = privJwk.d // already base64url

console.log('# --- VAPID keys (add to .dev.vars, keep secret) ---')
console.log(`VAPID_SUBJECT = "mailto:developer@labirentai.com"`)
console.log(`VAPID_PUBLIC = "${publicKey}"`)
console.log(`VAPID_PRIVATE = "${privateKey}"`)
