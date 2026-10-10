/* Payload-free RFC 8030 Web Push, authenticated with RFC 8292 VAPID.
   No company data, account identifiers or notification content leaves this server. */
const crypto = require('node:crypto');
const {problem} = require('./store.cjs');
function endpointURL(value) {
  let url;
  try { url = new URL(value); } catch { throw problem(400, 'INVALID_SUBSCRIPTION'); }
  const host = url.hostname;
  if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
      !(host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com' || host.endsWith('.notify.windows.com'))) throw problem(400, 'INVALID_SUBSCRIPTION');
  return url;
}
function validateSubscription(input) {
  endpointURL(input?.endpoint);
  const decode = (value, size) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw problem(400, 'INVALID_SUBSCRIPTION');
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length !== size) throw problem(400, 'INVALID_SUBSCRIPTION');
    return bytes;
  };
  const key = decode(input.keys?.p256dh, 65); decode(input.keys?.auth, 16);
  try { crypto.ECDH.convertKey(key, 'prime256v1'); } catch { throw problem(400, 'INVALID_SUBSCRIPTION'); }
  return {endpoint: input.endpoint}; // Payload-free delivery needs no recipient encryption keys.
}
function createWebPush({privateKey = '', subject = '', fetcher = fetch, now = Date.now} = {}) {
  if (!privateKey && !subject) return {publicKey: null};
  let key, publicKey;
  try {
    const jwk = JSON.parse(privateKey);
    key = crypto.createPrivateKey({key: jwk, format: 'jwk'});
    if (key.asymmetricKeyType !== 'ec' || jwk.crv !== 'P-256' || !/^(mailto:|https:)/.test(subject)) throw new Error();
    const pub = crypto.createPublicKey(key).export({format: 'jwk'});
    publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
  } catch { throw new Error('INVALID_PUSH_CONFIGURATION'); }
  async function send(endpoint) {
    const url = endpointURL(endpoint);
    const header = Buffer.from(JSON.stringify({typ: 'JWT', alg: 'ES256'})).toString('base64url');
    const claims = Buffer.from(JSON.stringify({aud: url.origin, exp: Math.floor(now() / 1000) + 3600, sub: subject})).toString('base64url');
    const input = header + '.' + claims;
    const signature = crypto.sign('sha256', Buffer.from(input), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url');
    const response = await fetcher(endpoint, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {Authorization: 'vapid t=' + input + '.' + signature + ', k=' + publicKey, TTL: '3600', Urgency: 'normal', Topic: 'hub-notification', 'Content-Length': '0'}, body: ''});
    await response.body?.cancel();
    return response.status;
  }
  return {publicKey, send};
}
module.exports = {createWebPush, validateSubscription, endpointURL};
