const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/statistics-downtime.js'), 'utf8')
  + ';this.pareto = calculateDowntimePareto;', sandbox);
const pareto = (entries, prefix) => JSON.parse(JSON.stringify(sandbox.pareto(entries, prefix)));
const entry = (date, durationMin, reason) => ({date, durationMin, reason});

test('pareto groups reasons by minutes and marks the rows that reach 80%', () => {
  const result = pareto([
    entry('2026-03-02', 50, 'Механична повреда'),
    entry('2026-03-09', 20, 'Механична повреда'),
    entry('2026-04-01', 20, 'Липса на материал'),
    entry('2026-04-03', 6, 'Друго'),
    entry('2026-05-01', 4, ' '),
    entry('2025-12-30', 500, 'Механична повреда')
  ], '2026-');
  assert.equal(result.totalMin, 100);
  assert.deepEqual(result.rows.map(row => [row.reason, row.durationMin, row.count, row.leading]), [
    ['Механична повреда', 70, 2, true],
    ['Липса на материал', 20, 1, true],
    ['Друго', 6, 1, false],
    ['Без посочена причина', 4, 1, false]
  ]);
  assert.deepEqual(result.rows.map(row => Math.round(row.cumulative)), [70, 90, 96, 100]);
  assert.equal(result.rows[1].share, 20);
});

test('pareto stops at exactly 80%, keeps all years for an empty prefix and ignores empty records', () => {
  const rows = pareto([entry('2025-01-01', 80, 'А'), entry('2026-01-01', 20, 'Б'), entry('2026-02-01', 0, 'В'), {durationMin: 9}], '').rows;
  assert.deepEqual(rows.map(row => [row.reason, row.leading]), [['А', true], ['Б', false]]);
  assert.deepEqual(pareto([], '2026-'), {totalMin: 0, rows: []});
});
