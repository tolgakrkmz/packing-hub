/* Generated ephemeral keys and fake outbound I/O only; no external requests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createWebPush, endpointURL, validateSubscription} = require('../../server/web-push.cjs');
function config(fetcher) {
  const {privateKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  return {privateKey: JSON.stringify(privateKey.export({format: 'jwk'})), subject: 'mailto:demo@example.test', fetcher};
}
function subscription() {
  const key = crypto.createECDH('prime256v1'); key.generateKeys();
  return {endpoint: 'https://fcm.googleapis.com/fcm/send/demo-boundary-token', keys: {p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url')}};
}
test('push endpoint policy rejects non-provider schemes, credentials, host tricks, alternate ports and fragments before transport', async () => {
  let requests = 0;
  const transport = createWebPush(config(async () => { requests++; throw new Error('Fictional unexpected transport'); }));
  for (const endpoint of [undefined, null, 7, {}, [], '', 'file:///demo', 'http://fcm.googleapis.com/demo', 'https://localhost/demo', 'https://127.0.0.1/demo', 'https://[::1]/demo', 'https://192.0.2.1/demo', 'https://user:password@fcm.googleapis.com/demo', 'https://fcm.googleapis.com@demo.example.test/demo', 'https://fcm.googleapis.com.demo.example.test/demo', 'https://demo-push.services.mozilla.com/demo', 'https://notify.windows.com.demo.example.test/demo', 'https://fcm.googleapis.com.:443/demo', 'https://fcm.googleapis.com:8443/demo', 'https://fcm.googleapis.com/demo#fragment']) {
    await assert.rejects(transport.send(endpoint), {code: 'INVALID_SUBSCRIPTION'});
  }
  assert.equal(requests, 0);
});
test('push endpoints accept provider subdomains and the exact URL length boundary', () => {
  for (const endpoint of ['https://updates.push.services.mozilla.com/demo', 'https://demo.push.services.mozilla.com/demo', 'https://web.push.apple.com/demo', 'https://demo.notify.windows.com/demo', 'https://FCM.GOOGLEAPIS.COM:443/demo']) assert.equal(endpointURL(endpoint).protocol, 'https:');
  const endpoint = 'https://fcm.googleapis.com/' + 'x'.repeat(2021);
  assert.equal(endpoint.length, 2048); assert.equal(endpointURL(endpoint).hostname, 'fcm.googleapis.com');
  assert.throws(() => endpointURL(endpoint + 'x'), {code: 'INVALID_SUBSCRIPTION'});
});
test('subscription validation refuses malformed key objects, encodings, lengths and off-curve public points', () => {
  const valid = subscription();
  assert.deepEqual(validateSubscription(valid), {endpoint: valid.endpoint});
  for (const keys of [undefined, null, [], {}, {p256dh: valid.keys.p256dh, auth: '!'}, {p256dh: valid.keys.p256dh + '=', auth: valid.keys.auth}, {p256dh: valid.keys.p256dh, auth: Buffer.alloc(17).toString('base64url')}, {p256dh: Buffer.alloc(65).toString('base64url'), auth: valid.keys.auth}, {p256dh: valid.keys.p256dh, auth: false}]) assert.throws(() => validateSubscription({...valid, keys}), {code: 'INVALID_SUBSCRIPTION'});
  for (const input of [null, [], false, 'demo']) assert.throws(() => validateSubscription(input), {code: 'INVALID_SUBSCRIPTION'});
});
test('payload-free push uses provider audience, HTTPS-only validated endpoint, bounded abort signal and cancels the response body', async () => {
  let request, cancelled = false;
  const options = config(async (endpoint, input) => {
    request = {endpoint, input};
    return {status: 201, body: {cancel: async () => { cancelled = true; }}};
  });
  const transport = createWebPush({...options, now: () => 2000000});
  assert.equal(await transport.send('https://web.push.apple.com/demo-boundary-token'), 201);
  assert.equal(cancelled, true); assert.equal(request.endpoint, 'https://web.push.apple.com/demo-boundary-token');
  assert.equal(request.input.method, 'POST'); assert.equal(request.input.redirect, 'error');
  assert.equal(request.input.body, ''); assert.equal(request.input.headers['Content-Length'], '0');
  assert.equal(request.input.signal instanceof AbortSignal, true); assert.equal(request.input.signal.aborted, false);
  const token = request.input.headers.Authorization.match(/t=([^,]+)/)[1];
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), {aud: 'https://web.push.apple.com', exp: 5600, sub: 'mailto:demo@example.test'});
  const key = crypto.createPublicKey(crypto.createPrivateKey({key: JSON.parse(options.privateKey), format: 'jwk'}));
  assert.equal(crypto.verify('sha256', Buffer.from(header + '.' + claims), {key, dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'base64url')), true);
});
test('a redirecting push provider cannot trigger a second request or forward VAPID authorization', async () => {
  const destinations = [];
  const transport = createWebPush(config(async (endpoint, input) => {
    destinations.push(endpoint);
    // Model the Fetch redirect policy at the network boundary, without network I/O.
    if (input.redirect === 'error') throw new TypeError('Fictional provider redirect rejected');
    destinations.push('https://demo.example.test/redirect-target');
    return {status: 201};
  }));
  await assert.rejects(transport.send('https://fcm.googleapis.com/demo-redirect'), {name: 'TypeError'});
  assert.deepEqual(destinations, ['https://fcm.googleapis.com/demo-redirect']);
});
test('push timeout aborts the transport rather than completing an unbounded request', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 10000); return controller.signal; });
  const transport = createWebPush(config(async (_endpoint, input) => {
    return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), {once: true}));
  }));
  const pending = transport.send('https://fcm.googleapis.com/demo-timeout');
  controller.abort(new DOMException('Fictional controlled timeout', 'TimeoutError'));
  await assert.rejects(pending, {name: 'TimeoutError'});
});
