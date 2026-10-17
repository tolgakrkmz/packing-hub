const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({StatisticsUnits: {formatKg: kg => `units:${kg}`}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/statistics-helpers.js'), 'utf8')
  + ';this.helpers = {fmt, fmtTons, fmtHoursDecimal, pad2, clamp, emptyShiftMap, niceChartMax, wfFmt, wfShiftCodeFor, SHIFT_ORDER};', sandbox);
const h = sandbox.helpers;
const plain = value => JSON.parse(JSON.stringify(value));

test('number formatting rounds, groups in Bulgarian and treats invalid input as zero or a dash', () => {
  assert.equal(h.fmt(1234.6), '1235');
  assert.equal(h.fmt(12345.4), '12 345');
  assert.equal(h.fmt('demo'), '0');
  assert.equal(h.fmtHoursDecimal(2.25), '2,3');
  assert.equal(h.fmtHoursDecimal(null), '0,0');
  assert.equal(h.wfFmt(1.5), '1,50');
  assert.equal(h.wfFmt(1.5, 1), '1,5');
  assert.equal(h.wfFmt('demo'), '—');
  assert.equal(h.fmtTons(1500), 'units:1500');
});

test('small helpers pad, clamp and start every shift at zero', () => {
  assert.equal(h.pad2(3), '03');
  assert.equal(h.pad2(12), '12');
  assert.equal(h.clamp(5, 0, 3), 3);
  assert.equal(h.clamp(-1, 0, 3), 0);
  assert.deepEqual(plain(h.emptyShiftMap()), Object.fromEntries(plain(h.SHIFT_ORDER).map(shift => [shift, 0])));
  assert.notEqual(h.emptyShiftMap(), h.emptyShiftMap());
});

test('chart maximum rounds up to 1, 2, 5 or 10 times the magnitude', () => {
  assert.equal(h.niceChartMax(0), 100000);
  assert.equal(h.niceChartMax(-5), 100000);
  assert.deepEqual([1000, 1500, 3200, 7000].map(h.niceChartMax), [1000, 2000, 5000, 10000]);
});

test('team rotation covers shifts 1-3 with one team off every day and repeats every 16 days', () => {
  const teams = ['А', 'Б', 'В', 'Г'];
  for (let day = -20; day < 20; day++) {
    const date = new Date(2026, 11, 1 + day);
    const codes = teams.map(team => h.wfShiftCodeFor(team, date));
    assert.deepEqual(codes.map(String).sort(), ['1', '2', '3', 'Н'], date.toDateString());
    assert.deepEqual(teams.map(team => h.wfShiftCodeFor(team, new Date(2026, 11, 17 + day))), codes);
  }
  assert.equal(h.wfShiftCodeFor('А', new Date(2026, 11, 1)), 3);
  assert.equal(h.wfShiftCodeFor('Б', new Date(2026, 11, 1)), 'Н');
});
