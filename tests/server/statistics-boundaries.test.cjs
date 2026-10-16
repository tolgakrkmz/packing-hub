const test = require('node:test');
const assert = require('node:assert/strict');
const {openStore} = require('../../server/store.cjs');
const {createStatisticsReads} = require('../../server/statistics.cjs');
test('leap-day and year-boundary projections retain exact fractional kg, zero reports and all five shift totals', t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const actor = {role: 'admin'};
  const rows = [
    ['2024-03-01', 'Г', 2000.25, 4.5], ['2023-12-31', 'Б', 1000, 1],
    ['2024-02-29', 'СТИКЕРИ', 123.75, 0.5], ['2024-12-31', 'В', 4001, 2], ['2024-02-28', 'А', 0, 0]
  ].map(([date, shift, tonnage, brak], index) => ({id: 'demo-boundary-' + index, date, shift, tonnage, brak, breakdown: null}));
  store.put('production-log', {entries: rows, goalTons: 10}, 1, actor,'import');
  const reads = createStatisticsReads(store), february = reads.read('production-log', '2024-02');
  assert.deepEqual(february.data.entries.map(row => row.date), ['2024-02-29', '2024-02-28']);
  assert.deepEqual(february.data.summary.availableYears, ['2023', '2024']);
  const annual = february.data.summary.years.find(row => row.key === '2024');
  assert.equal(annual.tonnage, 6125); assert.equal(annual.brak, 7);
  assert.deepEqual(annual.byShift, {А: 0, Б: 0, В: 4001, Г: 2000.25, СТИКЕРИ: 123.75});
  assert.equal(february.data.summary.months.filter(row => row.key.startsWith('2024-')).reduce((sum, row) => sum + row.tonnage, 0), annual.tonnage);
  assert.equal(reads.read('production-log', '2024-01').data.entries.length, 0);
  assert.equal(reads.read('production-log', '2023-12').data.entries[0].tonnage, 1000);
  assert.deepEqual(store.get('production-log').data.entries, rows);
});
