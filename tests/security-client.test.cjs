/* Inert fictional markers only; the worker harness cannot send network requests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {types, href} = require('../js/notification-model.js');
const marker = '<b data-client-demo>Fictional text</b> & "quoted"';

test('instruction escaping preserves literal text in both text and quoted attribute contexts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/package-instructions.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function escapeHtml(str) {'), source.indexOf('let activeCategoryFilter')), context);
  const escape = vm.runInContext('escapeHtml',context);
  assert.equal(escape('Fictional & <marker> "quote" \'single\''), 'Fictional &amp; &lt;marker&gt; &quot;quote&quot; &#39;single&#39;');
  assert.equal(escape(null),''); assert.equal(escape(990101),'990101');
});

test('every notification target stays in its intended local module and round-trips as data', () => {
  const base = 'http://127.0.0.1:12345';
  for (const [type, definition] of Object.entries(types)) for (const target of [marker, '//example.invalid/fictional', '../fictional?next=/tasks#demo', 'Fictional%2Ftarget']) {
    const url = new URL(href(type, target), base);
    assert.equal(url.origin, base);
    assert.equal(url.pathname, '/' + definition.module);
    assert.equal(url.hash, '');
    if (!type.startsWith('system')) assert.equal(url.searchParams.get('target'), target);
  }
  for (const target of [null, '', 'x'.repeat(1001), 42]) assert.equal(href('taskAssigned', target), '/tasks');
  assert.equal(href('fictional-unknown', marker), '/notifications');
});

function worker() {
  const handlers = new Map(), shown = [], opened = [], focused = [];
  let clients = [];
  const self = {
    addEventListener: (name, callback) => handlers.set(name, callback),
    skipWaiting() {}, registration: {showNotification: async (...args) => shown.push(args)},
    clients: {claim: async () => {}, matchAll: async () => clients,
      openWindow: async url => opened.push(url)}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/notification-worker.js'), 'utf8'), {self, URL});
  async function emit(name, extra = {}) {
    let promise;
    handlers.get(name)({...extra, waitUntil: value => { promise = value; }});
    await promise;
  }
  return {handlers, shown, opened, focused, emit, clients: urls => {
    clients = urls.map(url => ({url, focus: async () => focused.push(url)}));
  }};
}
test('notification worker ignores supplied content and keeps lock-screen copy generic', async () => {
  const w = worker();
  await w.emit('push', {data: {text() { throw new Error('The fictional payload must not be read'); }, json() { throw new Error('The fictional payload must not be read'); }}});
  assert.deepEqual(JSON.parse(JSON.stringify(w.shown)), [['Package Hub', {
    body: 'Имате ново известие / You have a new notification', tag: 'hub-notification', icon: '/assets/package-hub-icon-192.png'
  }]]);
  assert.equal(w.handlers.has('fetch'), false);
});
test('notification click ignores payload destinations and opens only the local inbox', async () => {
  const w = worker(); let closed = 0;
  const notification = {data: {href: '//example.invalid/fictional'}, close() { closed++; }};
  w.clients(['http://127.0.0.1:12345/tasks?target=fictional']);
  await w.emit('notificationclick', {notification});
  assert.deepEqual(w.opened, ['/notifications']);
  w.clients(['http://127.0.0.1:12345/notifications.html']);
  await w.emit('notificationclick', {notification});
  assert.deepEqual(w.focused, ['http://127.0.0.1:12345/notifications.html']);
  assert.equal(closed, 2);
});

test('file imports reject invalid dates, shifts and paths before a renderer accepts them', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/data-validation.js'), 'utf8'), context);
  const validate = vm.runInContext('HubDataValidation.validate', context);
  const entry = {id: marker, date:'2026-10-05', shift:'А', tonnage:1, brak:0};
  assert.equal(validate('production-log', {entries:[entry]}).entries[0].id, marker);
  for (const field of ['date','shift']) assert.throws(() => validate('production-log', {entries:[{...entry,[field]:marker}]}), {code:'HUB_DATA'});
  for (const folderName of ['../fictional', '/fictional', 'demo/../fictional', 'demo\\..\\fictional']) {
    assert.throws(() => validate('package-instructions', {demo:{number:'990101',name:marker,folderName,images:[]}}), {code:'HUB_DATA'});
  }
});
