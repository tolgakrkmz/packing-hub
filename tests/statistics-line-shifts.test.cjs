const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({StatisticsUnits: {formatKg: kg => `units:${kg}`}});
for (const file of ['statistics-helpers.js', 'statistics-line-shifts.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox);
const plain = value => JSON.parse(JSON.stringify(value));

test('sticker crates stay out of the automatic / manual line split', () => {
  const rows = vm.runInContext(`calculateLineShifts([
    {date:'2026-10-04', shift:'А', tonnage:1000, brak:0, breakdown:{autoKg:700, autoCrates:28, manKg:300, manCrates:12}},
    {date:'2026-10-04', shift:'СТИКЕРИ', tonnage:500, brak:0, breakdown:{autoKg:0, autoCrates:0, manKg:500, manCrates:42}}
  ])`, sandbox);
  assert.deepEqual(plain(rows), [{shift:'А', autoKg:700, autoCrates:28, manKg:300, manCrates:12}]);
});
