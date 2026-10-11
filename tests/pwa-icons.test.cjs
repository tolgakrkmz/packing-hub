const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('every install entry page includes the touch icon and one standalone manifest before scripts run', () => {
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    const head = read(file).match(/<head>([\s\S]*?)<\/head>/)[1];
    assert.match(head, /<link rel="apple-touch-icon" sizes="180x180" href="assets\/package-hub-icon-180\.png">/, file);
    assert.equal((head.match(/rel="manifest"/g) || []).length, 1, file);
    assert.match(head, /<link rel="manifest" href="manifest\.webmanifest">/, file);
  }
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/notifications.html');
  assert.deepEqual(manifest.icons, [192, 512].map(size => ({src: `/assets/package-hub-icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any'})));
});

test('install icons are opaque RGB PNGs of the declared dimensions and ship in the Docker context', () => {
  const dockerfile = read('Dockerfile'), ignore = read('.dockerignore').split('\n');
  for (const size of [180, 192, 512]) {
    const file = `assets/package-hub-icon-${size}.png`, png = fs.readFileSync(path.join(root, file));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 2); // RGB, without transparency.
    assert.ok(dockerfile.includes(file)); assert.ok(ignore.includes('!' + file));
  }
  for (const file of ['manifest.webmanifest', 'scripts/configure-push.cjs']) assert.ok(ignore.includes('!' + file));
});

test('push uses the public PNG icon and retains generic text without reading the payload or caching private files', async () => {
  const handlers = new Map(); let shown, work;
  const self = {addEventListener: (name, handler) => handlers.set(name, handler), registration: {showNotification: async (title, options) => { shown = {title, ...options}; }}};
  vm.runInNewContext(read('js/notification-worker.js'), {self});
  handlers.get('push')({get data() { throw new Error('Push payload must remain unread'); }, waitUntil: promise => { work = promise; }});
  await work;
  assert.equal(shown.title, 'Package Hub');
  assert.equal(shown.body, 'Имате ново известие / You have a new notification');
  assert.equal(shown.icon, '/assets/package-hub-icon-192.png');
  assert.equal(handlers.has('fetch'), false);
});
