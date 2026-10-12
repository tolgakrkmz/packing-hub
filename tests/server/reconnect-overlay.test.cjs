/* Real client lifecycle with deterministic time and fictional boot data only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function client(module = 'production-log') {
  let time = 0, timerId = 0;
  const timers = new Map(), history = [], nodes = [], streams = [];
  const events = new Map(), windowEvents = new Map();
  const listen = map => (name, callback) => { if (!map.has(name)) map.set(name, []); map.get(name).push(callback); };
  function element() {
    const attributes = new Map(), classes = new Set();
    const node = {hidden:false, children:[], append(...values) { this.children.push(...values); }, prepend(...values) { this.children.unshift(...values); },
      setAttribute: (key, value) => attributes.set(key, String(value)), getAttribute: key => attributes.get(key), addEventListener() {},
      classList: {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }}};
    nodes.push(node); return node;
  }
  const document = {hidden:false, addEventListener:listen(events), createElement:element, body:element(), querySelector:() => null,
    querySelectorAll:() => [], getElementById:id => nodes.find(node => node.id === id) || null};
  const context = vm.createContext({URLSearchParams, HubPermissions:require('../../js/permission-model.js'),
    window:{HUB_SERVER_BOOT:{user:{username:'demo-observer',role:'observer',permissions:require('../../server/permissions.cjs').defaults.observer},csrf:'fictional-csrf',version:'demo-version'},addEventListener:listen(windowEvents)},
    location:{pathname:'/' + module, assign() {}}, document, MutationObserver:class { observe() {} },
    EventSource:class { constructor() { this.readyState = 0; this.events = new Map(); streams.push(this); } addEventListener(name, callback) { this.events.set(name, callback); } close() { this.readyState = 2; } },
    setTimeout(callback, delay) { const entry = {id:++timerId, at:time + delay, delay, callback}; timers.set(entry.id, entry); history.push(entry); return entry.id; },
    clearTimeout:id => timers.delete(id), setInterval:() => 0});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/server-connection.js'), 'utf8'), context);
  for (const callback of events.get('DOMContentLoaded')) callback();
  const hub = vm.runInContext('HubServer', context);
  return {hub, history, streams, overlay:() => document.getElementById('serverReconnectOverlay'),
    visible:() => !!document.getElementById('serverReconnectOverlay') && !document.getElementById('serverReconnectOverlay').hidden,
    state:() => document.getElementById('serverState'),
    open() { streams[0].readyState = 1; streams[0].onopen(); },
    error() { streams[0].readyState = 0; streams[0].onerror(); },
    version() { streams[0].events.get('version')({data:JSON.stringify({version:'demo-version'})}); },
    change(module) { streams[0].events.get('change')({data:JSON.stringify({module})}); },
    visibility(hidden) { document.hidden = hidden; for (const callback of events.get('visibilitychange') || []) callback(); },
    pageshow() { for (const callback of windowEvents.get('pageshow') || []) callback({persisted:true}); },
    async advance(ms) {
      const end = time + ms;
      while (true) { const next = [...timers.values()].filter(timer => timer.at <= end).sort((a,b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break; time = next.at; timers.delete(next.id); next.callback(); await tick(); }
      time = end; await tick();
    }};
}
async function connected(c) { c.open(); c.version(); await tick(); }
test('initial connection reveals its visual only after 2300ms', async () => {
  const c = client(); assert.equal(c.visible(),false);
  await c.advance(2299); assert.equal(c.visible(),false);
  await c.advance(1); assert.equal(c.visible(),true);
});
test('a quick connection cancels the reveal without flashing', async () => {
  const c = client(); await c.advance(2000); assert.equal(c.visible(),false);
  await connected(c); await c.advance(500); assert.equal(c.visible(),false);
  c.error(); await c.advance(2000); assert.equal(c.visible(),false);
  await connected(c); await c.advance(500); assert.equal(c.visible(),false);
  assert.equal(c.state().getAttribute('data-connection'),'ready');
});
test('transport open waits for the version snapshot cohort before clearing blur', async () => {
  const c = client(); let release;
  c.hub.watch('demo-data', () => new Promise(resolve => { release = resolve; }));
  await c.advance(2300); c.open(); await tick(); assert.equal(c.visible(),true);
  c.version(); await tick(); assert.equal(c.visible(),true);
  release(); await tick(); assert.equal(c.visible(),false);
});
test('recovery waits for an active read and the change queued behind it', async () => {
  const c = client(); await connected(c); const releases = []; let reading = 0, maxReading = 0;
  c.hub.watch('demo-data', async () => { maxReading = Math.max(maxReading, ++reading); await new Promise(resolve => releases.push(resolve)); reading--; });
  c.change('demo-data'); c.error(); await c.advance(2300); c.open(); c.version(); await tick();
  assert.equal(c.visible(),true); assert.equal(maxReading,1);
  releases.shift()(); await tick(); assert.equal(c.visible(),true);
  releases.shift()(); await tick(); assert.equal(c.visible(),false); assert.equal(maxReading,1);
});
test('repeated transport errors cannot extend the eight-second visual deadline', async () => {
  const c = client(); await connected(c); c.error(); await c.advance(4000); assert.equal(c.visible(),true);
  c.error(); await c.advance(3999); assert.equal(c.visible(),true);
  await c.advance(1); assert.equal(c.visible(),false); assert.equal(c.state().getAttribute('data-connection'),'pending');
  c.error(); await c.advance(200); assert.equal(c.visible(),false);
  await connected(c); c.error(); await c.advance(2300); assert.equal(c.visible(),true);
});
test('a snapshot that never settles does not hold the visual beyond eight seconds', async () => {
  const c = client(); c.hub.watch('demo-data', () => new Promise(() => {})); c.open(); c.version();
  await c.advance(7999); assert.equal(c.visible(),true);
  await c.advance(1); assert.equal(c.visible(),false);
});
test('an old snapshot completion cannot dismiss a newer reconnect attempt', async () => {
  const c = client(); let release;
  c.hub.watch('demo-data', () => new Promise(resolve => { release = resolve; }));
  c.open(); c.version(); await c.advance(2300); c.error(); await c.advance(2300);
  release(); await tick(); assert.equal(c.visible(),true);
  await c.advance(5700); assert.equal(c.visible(),false);
});
test('callbacks from cancelled timers cannot change a newer attempt', async () => {
  const c = client(); const oldTimers = c.history.filter(timer => [2300,8000].includes(timer.delay));
  await connected(c); c.error(); await c.advance(2300); assert.equal(c.visible(),true);
  for (const timer of oldTimers) timer.callback(); await tick();
  assert.equal(c.visible(),true);
});
test('foreground catch-up reads a callback shared across modules only once', async () => {
  const c = client(); await connected(c); let reads = 0, release;
  const refresh = () => { reads++; return new Promise(resolve => { release = resolve; }); };
  c.hub.watch('demo-one', refresh); c.hub.watch('demo-two', refresh);
  c.visibility(true); c.change('demo-one'); c.change('demo-two'); await c.advance(2300);
  assert.equal(reads,0);
  c.visibility(false); await c.advance(2300); assert.equal(reads,1); assert.equal(c.visible(),true);
  release(); await tick(); assert.equal(c.visible(),false);
});
test('a busy draft defers reading without holding blur and refreshes after it closes', async () => {
  const c = client(); await connected(c); let busy = true, reads = 0;
  c.hub.watch('demo-data', async () => { reads++; }, () => busy);
  c.visibility(true); c.visibility(false); await c.advance(2300);
  assert.equal(c.visible(),false); assert.equal(reads,0);
  busy = false; await c.advance(100); assert.equal(reads,1);
});
test('failed refresh work clears the decorative visual', async () => {
  const c = client(); let reject;
  c.hub.watch('demo-data', () => new Promise((_, fail) => { reject = fail; }));
  c.open(); c.version(); await c.advance(2300); assert.equal(c.visible(),true);
  reject(new Error('Fictional connection failure')); await tick(); assert.equal(c.visible(),false);
});
test('a failed active read keeps recovery waiting for its queued retry', async () => {
  const c = client(); await connected(c); let reject, release, reads = 0;
  c.hub.watch('demo-data', () => ++reads === 1
    ? new Promise((_, fail) => { reject = fail; })
    : new Promise(resolve => { release = resolve; }));
  c.change('demo-data'); c.error(); c.open(); c.version(); await c.advance(2300);
  reject(new Error('Fictional interrupted read')); await tick();
  assert.equal(reads,2); assert.equal(c.visible(),true);
  release(); await tick(); assert.equal(c.visible(),false);
});
test('a disconnected foreground resume waits for the new version refresh barrier', async () => {
  const c = client(); await connected(c); const releases = [];
  c.hub.watch('demo-data', () => new Promise(resolve => releases.push(resolve)));
  c.error(); c.visibility(true); c.visibility(false); c.open(); await c.advance(2300);
  releases.shift()(); await tick(); assert.equal(c.visible(),true);
  c.version(); await tick(); assert.equal(c.visible(),true);
  releases.shift()(); await tick(); assert.equal(c.visible(),false);
});
test('persisted pageshow refreshes once after the same foreground transition', async () => {
  const c = client(); await connected(c); let reads = 0, release;
  c.hub.watch('demo-data', () => { reads++; return new Promise(resolve => { release = resolve; }); });
  c.visibility(true); c.visibility(false); c.pageshow(); await c.advance(2300);
  assert.equal(reads,1); assert.equal(c.visible(),true);
  release(); await tick(); assert.equal(reads,1); assert.equal(c.visible(),false);
});
test('manual report-history never waits for an absent event stream', async () => {
  const c = client('report-history'); c.pageshow(); c.visibility(false); await c.advance(8000);
  assert.equal(c.streams.length,0); assert.equal(c.overlay(),null); assert.equal(c.state().getAttribute('data-connection'),'ready');
});
