const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(sandbox, file) { vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox); }
const sandbox = vm.createContext({Date});
for (const file of ['shift-schedule', 'pair-targets-model', 'pair-targets-statistics-model']) load(sandbox, file);
const model = vm.runInContext('PairTargetsStatistics', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
function entry(id, overrides = {}) {
  return {id, date:'2026-10-04', shiftCode:1, team:'А',
    members:[{id:id+'-1', name:'Демо човек 1'}, {id:id+'-2', name:'Демо човек 2'}],
    areas:['auto','manual'], targetKg:100, targetCrates:10, result:null, ...overrides};
}
const output = (kg, crates, reasonKey = '', reasonText = '') => ({kg, crates, reasonKey, reasonText});
test('pending plans are separate and both targets determine success', () => {
  const entries = [entry('pending', {targetKg:1000, targetCrates:100}),
    entry('ok', {result:output(100,10)}), entry('missed', {result:output(200,9,'materials')})];
  const before = JSON.stringify(entries);
  const result = model.aggregate(entries, '2026-10');
  assert.equal(result.planned, 3);
  assert.equal(result.reported, 2);
  assert.equal(result.pending, 1);
  assert.equal(result.achieved, 1);
  assert.equal(result.missed, 1);
  assert.equal(result.successPct, 50);
  assert.equal(result.plannedKg, 1200);
  assert.equal(result.plannedCrates, 120);
  assert.equal(result.reportedTargetKg, 200);
  assert.equal(result.reportedTargetCrates, 20);
  assert.equal(result.kgPct, 150);
  assert.equal(result.cratesPct, 95);
  assert.equal(result.averageKg, 150);
  assert.equal(JSON.stringify(entries), before);
});
test('ratios are weighted by targets; overproduction cannot cancel another pair deficit', () => {
  const result = model.aggregate([entry('small', {result:output(200,20)}),
    entry('large', {targetKg:900, targetCrates:90, result:output(450,45,'downtime')})], '2026-10');
  assert.equal(result.kgPct, 65);
  assert.equal(result.cratesPct, 65);
  assert.equal(result.deficitKg, 450);
  assert.equal(result.deficitCrates, 45);
});
test('zero reports count as reported; empty or pending-only scopes have no ratios', () => {
  const zero = model.aggregate([entry('zero', {result:output(0,0,'downtime')})], '2026-10');
  assert.equal(zero.reported, 1);
  assert.equal(zero.kgPct, 0);
  assert.equal(zero.successPct, 0);
  assert.equal(zero.averageKg, 0);
  for (const entries of [[], [entry('pending')]]) {
    const result = model.aggregate(entries, '2026-10');
    for (const key of ['successPct','kgPct','cratesPct','averageKg']) assert.equal(result[key], null);
    assert.equal(result.deficitKg, 0);
  }
});
test('month and team scope use shift start dates, include stickers, and count mixed areas once', () => {
  const entries = [entry('night', {date:'2026-09-30', shiftCode:3, result:output(100,10)}),
    entry('mixed', {result:output(100,10)}), entry('stickers', {team:'СТИКЕРИ', result:output(100,10)}),
    entry('year', {date:'2025-10-04', result:output(100,10)})];
  const october = model.aggregate(entries, '2026-10');
  assert.equal(october.planned, 2);
  assert.equal(october.actualKg, 200);
  assert.deepEqual(plain(october.teams.map(group => group.team)), ['А','СТИКЕРИ']);
  assert.equal(model.aggregate(entries, '2026-10', 'А').actualKg, 100);
  assert.equal(model.aggregate(entries, '2026-09').reported, 1);
  assert.equal(model.aggregate(entries, '2026-10', 'Б').planned, 0);
});
test('reasons count missed reports and handle free-text explanations as other', () => {
  const result = model.aggregate([
    entry('one', {result:output(0,0,'materials')}), entry('two', {result:output(1,1,'materials')}),
    entry('free', {result:output(0,0,'','Демо обяснение')}),
    entry('ok', {result:output(100,10)}), entry('pending')], '2026-10');
  assert.deepEqual(plain(result.reasons.map(reason => [reason.key,reason.count])), [['materials',2],['other',1]]);
  assert.equal(result.reasons.reduce((sum, reason) => sum + reason.count, 0), result.missed);
});
test('read-only dashboard loads independently, preserves filters, rejects invalid files and escapes notes', () => {
  class Control {
    constructor() { this.value = ''; this.innerHTML = ''; this.listeners = {}; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    querySelectorAll() { return []; }
  }
  const controls = new Map();
  let config, inits = 0;
  const ui = vm.createContext({Date, period:'2026-10',
    document:{getElementById(id) { if (!controls.has(id)) controls.set(id,new Control()); return controls.get(id); }},
    createFileSync(cfg) { config = cfg; return {init() { inits++; }}; }
  });
  for (const file of ['shift-schedule','pair-targets-model','pair-targets-statistics-model','pair-targets-statistics']) load(ui,file);
  const dashboard = vm.runInContext("createPairTargetsStatistics({dbName:'demo-pairs',localStorageKey:'demo-pairs',getPeriod:() => period,onDataChange:() => {}})", ui);
  assert.equal(config.readOnly, true);
  assert.equal(config.strictJson, true);
  dashboard.render();
  assert.match(controls.get('pairStatsBody').innerHTML, /Няма свързан файл/);
  dashboard.init(); dashboard.init();
  assert.equal(inits, 1);
  config.onConnect({module:'pair-targets',schemaVersion:1,entries:[
    entry('one', {result:output(0,0,'other','<img src=x onerror=alert(1)>')}),
    entry('old', {date:'2025-12-31'})]});
  dashboard.render();
  assert.match(controls.get('pairStatsPeriod').textContent, /октомври 2026/);
  assert.deepEqual(plain(dashboard.getYears()), ['2026','2025']);
  assert.match(controls.get('pairStatsBody').innerHTML, /&lt;img/);
  assert.doesNotMatch(controls.get('pairStatsBody').innerHTML, /<img/);
  ui.period = '2025-12';
  dashboard.render();
  assert.match(controls.get('pairStatsPeriod').textContent, /декември 2025/);
  ui.period = '2026-09';
  dashboard.render();
  assert.match(controls.get('pairStatsBody').innerHTML, /Няма двойки за избрания/);
  assert.match(controls.get('pairStatsPeriod').textContent, /септември 2026/);
  const accepted = config.getData();
  assert.throws(() => config.onRefresh({entries:[]}));
  assert.equal(config.getData(), accepted);
  controls.get('pairStatsTeam').value = 'Б';
  controls.get('pairStatsTeam').listeners.change();
  assert.match(controls.get('pairStatsBody').innerHTML, /Няма двойки за избрания/);
});
