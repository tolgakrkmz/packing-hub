const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/line-productivity-model.js'), 'utf8') + ';this.live = LineProductivity.compute;', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));

test('live line productivity uses pair headcount and the shift breakdown', () => {
  const production = [
    {date:'2026-10-01', shift:'А', tonnage:9000, breakdown:{autoKg:6000, manKg:3000}},
    {date:'2026-10-02', shift:'Б', tonnage:4000, breakdown:{autoKg:4000, manKg:0}},
    {date:'2026-10-03', shift:'В', tonnage:5000},
    {date:'2026-09-30', shift:'А', tonnage:9000, breakdown:{autoKg:9000, manKg:0}},
    {date:'2026-10-01', shift:'СТИКЕРИ', tonnage:1000, breakdown:{autoKg:1000, manKg:0}}
  ];
  const pair = (date, team, areas, extra = {}) => ({date, team, areas, members:[{}, {}], ...extra});
  const pairs = [
    pair('2026-10-01', 'А', ['auto']), pair('2026-10-01', 'А', ['auto']),
    pair('2026-10-01', 'А', ['auto', 'manual']),
    pair('2026-10-01', 'А', ['manual'], {cancellation:{reasonKey:'x'}}),
    pair('2026-10-02', 'Б', ['auto']),
    pair('2026-10-03', 'В', ['manual']),
    pair('2026-10-04', 'Г', ['auto']),
    pair('2026-09-30', 'А', ['auto']),
    pair('2026-10-01', 'СТИКЕРИ', ['auto'])
  ];
  const result = plain(sandbox.live(production, pairs));
  // Auto covers every month: (6000 + 4000 + 9000) kg over 5 + 2 + 2 people; the mixed pair adds one person to each line.
  assert.deepEqual(result.auto, {kg:19000, people:9, shifts:3, tonsPerPerson:19 / 9});
  // Manual: only the mixed pair's half on 1 October; the cancelled pair and shifts without a breakdown are left out.
  assert.deepEqual(result.manual, {kg:3000, people:1, shifts:1, tonsPerPerson:3});
});

test('live line productivity is empty without matching pairs', () => {
  const result = plain(sandbox.live([{date:'2026-10-01', shift:'А', breakdown:{autoKg:1000, manKg:1000}}], []));
  assert.equal(result.auto.tonsPerPerson, null);
  assert.equal(result.manual.tonsPerPerson, null);
});
