const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function client({module = 'production-log', period} = {}) {
  let events, fetchData = async () => response(1), renders = 0;
  const callbacks = new Map();
  const element = () => ({append() {}, setAttribute() {}, addEventListener() {}, hidden: false});
  const context = vm.createContext({
    URLSearchParams,
    HubPermissions: require('../../js/permission-model.js'),
    window: {HUB_SERVER_BOOT: {user: {username: 'demo-observer', role: 'observer', permissions: require('../../server/permissions.cjs').defaults.observer}, csrf: 'fictional-csrf', version: 'demo-version'}, addEventListener() {}},
    location: {pathname: '/' + module},
    document: {hidden:false, addEventListener: (name, callback) => { if (!callbacks.has(name)) callbacks.set(name,[]); callbacks.get(name).push(callback); }, createElement: element, body: {prepend() {}, append() {}, classList: {add() {}}}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null},
    MutationObserver: class { observe() {} },
    EventSource: class { constructor() { events = new Map(); } addEventListener(name, callback) { events.set(name, callback); } },
    registerConnectionPanel: () => () => {},
    fetch: (...args) => fetchData(...args), setTimeout:(callback,ms) => { const timer = setTimeout(callback,ms); if ([2300,8000].includes(ms)) timer.unref(); return timer; }, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/server-shell.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/server-connection.js'), 'utf8'), context);
  const hub = vm.runInContext('HubServer', context);
  const accepted = [];
  let busy = false;
  const sync = hub.fileSync({suggestedFileName: 'production-log.json', getStatisticsPeriod:period, elements: {connDot: element(), connText: element()}, render() { renders++; }, onConnect: value => accepted.push(value.value), onRefresh: value => accepted.push(value.value), isBusy: () => busy});
  for (const callback of callbacks.get('DOMContentLoaded')) callback();
  return {sync, hub, accepted, get renders() { return renders; }, fetching: callback => { fetchData = callback; }, busy: value => { busy = value; }, visibility: hidden => { context.document.hidden = hidden; for (const callback of callbacks.get('visibilitychange') || []) callback(); }, emit: (module = 'production-log') => events.get('change')({data: JSON.stringify({module})})};
}
function response(value, extra = {}) { return {ok: true, json: async () => ({revision: value, data: {value}, ...extra})}; }
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
test('an overlapping live read does not discard the explicit review snapshot or apply it over newer data', async () => {
  const c = client(); await c.sync.init();
  let release, reads = 0;
  c.fetching(() => ++reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response(3)));
  const review = c.sync.refreshFromDisk();
  await c.sync.refreshFromDisk({fresh:true}); release(response(2));
  assert.equal((await review).revision,2);
  assert.deepEqual(c.accepted,[1,3]);
});
test('concurrent refreshes share one request and unchanged snapshots skip acceptance and render', async () => {
  const c = client(); await c.sync.init();
  let release, reads = 0;
  c.fetching(() => { reads++; return new Promise(resolve => { release = resolve; }); });
  const first = c.sync.refreshFromDisk(), second = c.sync.refreshFromDisk();
  assert.equal(first,second); release(response(1)); await Promise.all([first,second]);
  assert.equal(reads,1); assert.deepEqual(c.accepted,[1]); assert.equal(c.renders,1);
  c.fetching(async () => response(2)); await c.sync.refreshFromDisk();
  assert.deepEqual(c.accepted,[1,2]); assert.equal(c.renders,2);
});
test('hidden-page events make no reads and visible resume accepts the latest snapshot', async () => {
  const c = client(); await c.sync.init(); let reads = 0;
  c.fetching(async () => { reads++; return response(3); });
  c.visibility(true); c.emit(); c.emit(); await tick(); assert.equal(reads,0);
  c.visibility(false); await tick(); assert.equal(reads,1); assert.deepEqual(c.accepted,[1,3]);
});
test('a stale failed request cannot turn a newer connection off', async () => {
  const c = client(); await c.sync.init(); let reject;
  c.fetching(() => new Promise((_, fail) => { reject = fail; }));
  const stale = c.sync.refreshFromDisk();
  c.fetching(async () => response(2)); await c.sync.refreshFromDisk({fresh:true});
  reject(new Error('Fictional connection failure')); await assert.rejects(stale);
  assert.equal(c.sync.isReady,true); assert.deepEqual(c.accepted,[1,2]);
});
test('one callback watching multiple modules shares its queue and retains a change during reading', async () => {
  const c = client(); let reads = 0, release;
  const refresh = () => { reads++; return reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); };
  c.hub.watch('demo-first',refresh); c.hub.watch('demo-second',refresh); c.hub.watch('demo-first',refresh);
  c.emit('demo-first'); c.emit('demo-second'); c.emit('demo-first');
  assert.equal(reads,1); release(); await tick(); assert.equal(reads,2);
});
test('changing the statistics period supersedes a slow old-period response without coalescing different URLs',async () => {
  let month = '2026-10';
  const c = client({module:'statistics',period:() => ({month,scope:'year'})});
  let release; const urls = [];
  c.fetching(url => { urls.push(url); return urls.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response(3)); });
  const stale = c.sync.refreshFromDisk(); month = '2026-09';
  await c.sync.refreshFromDisk(); release(response(2)); await stale;
  assert.deepEqual(urls,['/api/statistics/period/production-log?month=2026-10','/api/statistics/period/production-log?month=2026-09']);
  assert.deepEqual(c.accepted,[3]); assert.equal(c.sync.isReady,true);
});
test('statistics projections cannot commit documents or report operations, even when initialized',async () => {
  const c = client({module:'statistics',period:() => ({month:'2026-10',scope:'year'})}); await c.sync.init();
  c.fetching(() => { throw new Error('A projection must not write'); });
  await assert.rejects(c.sync.commitData(),/Само за преглед/);
  await assert.rejects(c.sync.commitOperation({}),/Само за преглед/);
});

const demoOperation = action => ({operationId:'demo-operation', entryId:'demo-entry', action, entry:{id:'demo-entry'}});
const demoReceipt = action => ({operationId:'demo-operation', entryId:'demo-entry', action, status:'confirmed', version:2,
  message:action === 'delete' ? 'REPORT_DELETED' : action === 'restore' ? 'REPORT_RESTORED' : 'REPORT_SAVED'});
for (const [name, receipt] of [
  ['missing receipt', undefined], ['null receipt', null],
  ['other operation', {...demoReceipt('create'), operationId:'demo-other-operation'}],
  ['other entry', {...demoReceipt('create'), entryId:'demo-other-entry'}],
  ['missing entry', {...demoReceipt('create'), entryId:undefined}],
  ['other action', {...demoReceipt('create'), action:'delete'}],
  ['missing action', {...demoReceipt('create'), action:undefined}],
  ['deletion message for create', {...demoReceipt('create'), message:'REPORT_DELETED'}],
  ['restore message for create', {...demoReceipt('create'), message:'REPORT_RESTORED'}],
  ['unconfirmed status', {...demoReceipt('create'), status:'pending'}]
]) {
  test('report confirmation rejects ' + name + ' without accepting data or versions', async () => {
    const c = client(); c.fetching(async () => response(1, {versions:{'demo-entry':1}})); await c.sync.init();
    c.fetching(async () => response(2, {receipt, versions:{'demo-entry':2}}));
    await assert.rejects(c.sync.commitOperation(demoOperation('create')), /не потвърди/);
    assert.deepEqual(c.accepted, [1]); assert.equal(c.sync.recordVersion('demo-entry'), 1);
  });
}
for (const action of ['create','update','delete','restore']) {
  test('matching ' + action + ' confirmation and replay accept current data with the original receipt', async () => {
    const c = client(); await c.sync.init();
    const receipt = demoReceipt(action), operation = demoOperation(action);
    c.fetching(async () => response(2, {receipt, versions:{'demo-entry':2}}));
    const result = await c.sync.commitOperation(operation);
    assert.equal(result.receipt, receipt); assert.deepEqual(c.accepted, [1,2]);
    c.fetching(async () => response(3, {receipt, replayed:true, versions:{'demo-entry':3}}));
    const retry = await c.sync.commitOperation(operation);
    assert.equal(retry.receipt, receipt); assert.deepEqual(c.accepted, [1,2,3]);
  });
}
test('retrying a mismatched confirmation sends the same operation identity and accepts the valid receipt', async () => {
  const c = client(); await c.sync.init(); const bodies = [], operation = demoOperation('create');
  c.fetching(async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return response(2, {receipt:bodies.length === 1 ? {...demoReceipt('create'), entryId:'demo-other-entry'} : demoReceipt('create')});
  });
  await assert.rejects(c.sync.commitOperation(operation), /не потвърди/);
  await c.sync.commitOperation(operation);
  assert.deepEqual(bodies, [operation,operation]); assert.deepEqual(c.accepted, [1,2]);
});
