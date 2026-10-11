const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/statistics-cache.js'), 'utf8'), sandbox);
const create = sandbox.createStatisticsCache;
test('period calculations reuse the accepted snapshot and replace every stale period after a source change', () => {
  const cache = create(), first = {}, next = {}; let calls = 0;
  const compute = () => ({value: ++calls});
  const october = cache.get('reports', [first], '2026-10', compute);
  cache.get('reports', [first], '2026-09', compute);
  assert.equal(cache.get('reports', [first], '2026-10', compute), october);
  assert.equal(calls, 2);
  assert.notEqual(cache.get('reports', [next], '2026-10', compute), october);
  cache.get('reports', [next], '2026-09', compute);
  assert.equal(calls, 4);
});
test('source dependencies, goals and day keys invalidate independently; empty results remain cached', () => {
  const cache = create(), reports = {}, roster = {}; let calls = 0;
  const empty = () => { calls++; return null; };
  cache.get('monthly', [reports, 10], '2026-10|2026-10-05', empty);
  cache.get('monthly', [reports, 10], '2026-10|2026-10-05', empty);
  cache.get('monthly', [reports, 20], '2026-10|2026-10-05', empty);
  cache.get('monthly', [reports, 20], '2026-10|2026-10-06', empty);
  cache.get('workforce', [reports, roster], '2026-10', empty);
  cache.get('workforce', [reports, {}], '2026-10', empty);
  assert.equal(calls, 5);
});
test('the bounded cache evicts the least recently used period', () => {
  const cache = create(2); let calls = 0;
  const compute = () => ++calls;
  cache.get('period', [], 'a', compute); cache.get('period', [], 'b', compute);
  assert.equal(cache.get('period', [], 'a', compute), 1);
  cache.get('period', [], 'c', compute);
  assert.equal(cache.get('period', [], 'a', compute), 1);
  assert.equal(cache.get('period', [], 'b', compute), 4);
});
test('render stamps skip unrelated updates but render period roundtrips and changed sources', () => {
  const cache = create(), reports = {}; const rendered = [];
  const show = key => cache.update('monthly', [reports], key, () => rendered.push(key));
  show('october'); show('october'); show('september'); show('october');
  cache.update('pairs', [{}], 'october', () => {}); show('october');
  cache.update('monthly', [{}], 'october', () => rendered.push('new reports'));
  assert.deepEqual(rendered, ['october', 'september', 'october', 'new reports']);
});
test('failed calculations and failed renders can be retried without accepting partial state', () => {
  const cache = create(); let attempts = 0;
  const fail = () => { attempts++; throw new Error('Fictional calculation failure'); };
  assert.throws(() => cache.get('period', [], 'a', fail));
  assert.equal(cache.get('period', [], 'a', () => 42), 42);
  assert.throws(() => cache.update('period', [], 'a', fail));
  cache.update('period', [], 'a', () => { attempts++; });
  assert.equal(attempts, 3);
});
