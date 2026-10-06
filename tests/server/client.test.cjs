const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function client() {
  let loaded, events, fetchData = async () => response(1);
  const element = () => ({append() {}, setAttribute() {}, addEventListener() {}, hidden: false});
  const context = vm.createContext({
    window: {HUB_SERVER_BOOT: {user: {username: 'demo-observer', role: 'observer'}, csrf: 'fictional-csrf', version: 'demo-version'}},
    location: {pathname: '/production-log.html'},
    document: {addEventListener: (_, callback) => { loaded = callback; }, createElement: element, body: {prepend() {}, classList: {add() {}}}, querySelectorAll: () => [], getElementById: () => null},
    MutationObserver: class { observe() {} },
    EventSource: class { constructor() { events = new Map(); } addEventListener(name, callback) { events.set(name, callback); } },
    registerConnectionPanel: () => () => {},
    fetch: (...args) => fetchData(...args), setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/server-connection.js'), 'utf8'), context);
  const hub = vm.runInContext('HubServer', context);
  const accepted = [];
  let busy = false;
  const sync = hub.fileSync({suggestedFileName: 'production-log.json', elements: {connDot: element(), connText: element()}, render() {}, onConnect: value => accepted.push(value.value), onRefresh: value => accepted.push(value.value), isBusy: () => busy});
  loaded();
  return {sync, accepted, fetching: callback => { fetchData = callback; }, busy: value => { busy = value; }, emit: () => events.get('change')({data: JSON.stringify({module: 'production-log'})})};
}
function response(value) { return {ok: true, json: async () => ({revision: value, data: {value}})}; }
test('a change received during a slow refresh triggers another read instead of leaving older data on screen', async () => {
  const c = client(); await c.sync.init();
  let release, reads = 0;
  c.fetching(() => ++reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response(3)));
  c.emit(); await tick(); c.emit(); release(response(2));
  for(let count = 0; count < 10 && c.accepted.at(-1) !== 3; count++) await tick();
  assert.equal(reads, 2); assert.deepEqual(c.accepted, [1, 2, 3]);
});
test('live refresh waits for a busy save and then accepts the latest data', async () => {
  const c = client(); await c.sync.init();
  let reads = 0;
  c.fetching(async () => { reads++; return response(2); });
  c.busy(true); c.emit(); await tick();
  assert.equal(reads, 0); assert.deepEqual(c.accepted, [1]);
  c.busy(false); await new Promise(resolve => setTimeout(resolve, 240));
  assert.equal(reads, 1); assert.deepEqual(c.accepted, [1, 2]);
});
