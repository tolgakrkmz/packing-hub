const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({Date, Intl});
for (const file of ['shift-schedule', 'statistics-overview', 'statistics-comparison']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), sandbox);
const [comparison, schedule] = vm.runInContext('[StatisticsComparison, ShiftSchedule]', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const at = (date, hour, minute = 0) => schedule.sofiaInstant(date, hour, minute);
const scheduled = date => schedule.TEAMS.filter(team => schedule.shiftInterval(team, date));

test('periods cover the same completed days and only completed days', () => {
  const now = at('2026-10-05', 8, 30);
  assert.deepEqual(plain(comparison.ranges('2026-10', 'month', now)), {partial:true,
    current:{month:'2026-10', from:'2026-10-01', to:'2026-10-04', days:4}, base:{month:'2026-09', from:'2026-09-01', to:'2026-09-04', days:4}});
  // Before 06:00 the night shift of the previous day is still running.
  assert.equal(comparison.ranges('2026-10', 'month', at('2026-10-05', 5, 59)).current.to, '2026-10-03');
  assert.deepEqual(plain(comparison.ranges('2026-10', 'year', now).base), {month:'2025-10', from:'2025-10-01', to:'2025-10-04', days:4});
  assert.deepEqual(plain(comparison.ranges('2026-01', 'month', now).base), {month:'2025-12', from:'2025-12-01', to:'2025-12-31', days:31});
  const march = comparison.ranges('2026-03', 'month', now);
  assert.deepEqual(plain([march.partial, march.current.days, march.base.to]), [false, 31, '2026-02-28']);
  const future = comparison.ranges('2026-11', 'month', now);
  assert.deepEqual(plain([future.current.from, future.base.from, future.partial]), [null, null, true]);
  assert.equal(comparison.ranges('2026-10', 'month', at('2026-10-01', 12)).current.from, null);
});

test('summary counts scheduled shifts, missing reports and exact denominators', () => {
  const [first, second] = scheduled('2026-10-01');
  const production = [
    {date:'2026-10-01', shift:first, tonnage:30000, brak:600},
    {date:'2026-10-01', shift:first, tonnage:6000, brak:0},
    {date:'2026-10-01', shift:second, tonnage:24000, brak:600},
    {date:'2026-10-01', shift:'СТИКЕРИ', tonnage:3000, brak:0},
    {date:'2026-10-03', shift:first, tonnage:99999, brak:0}
  ];
  const downtime = [{date:'2026-10-02', durationMin:45}, {date:'2026-10-03', durationMin:500}];
  const result = comparison.summarize({from:'2026-10-01', to:'2026-10-02', days:2, production, downtime});
  const expected = scheduled('2026-10-01').length + scheduled('2026-10-02').length;
  assert.equal(result.kg, 63000);
  assert.equal(result.brak, 1200);
  assert.equal(result.reports, 4);
  assert.equal(result.kgPerDay, 31500);
  assert.equal(result.kgPerShift, 30000, 'stickers are outside the team schedule');
  assert.equal(Math.round(result.scrapPct * 100) / 100, 1.9);
  assert.equal(result.downtimeMin, 45);
  assert.deepEqual(plain([result.expectedShifts, result.reportedShifts, result.missing.length]), [expected, 2, expected - 2]);
  assert.equal(result.coveragePct, 2 / expected * 100);
  assert.ok(result.missing.every(shift => shift.code && !(shift.date === '2026-10-01' && [first, second].includes(shift.team))));
});

test('empty periods and a zero base have no misleading percentages', () => {
  const empty = comparison.summarize({from:null, to:null, production:[{date:'2026-10-01', tonnage:1}]});
  assert.deepEqual(plain([empty.kg, empty.scrapPct, empty.kgPerDay, empty.kgPerShift, empty.coveragePct, empty.missing]), [0, null, null, null, null, []]);
  const now = at('2026-10-05', 8, 30);
  const result = comparison.compare({month:'2026-10', production:[{date:'2026-10-02', shift:'А', tonnage:2000, brak:100}, {date:'2026-09-30', shift:'А', tonnage:500, brak:0}], now});
  assert.equal(result.base.kg, 0, 'September 30 is outside the compared days 1-4');
  assert.deepEqual(plain(result.changes.kg), {diff:2000, pct:null});
  assert.equal(result.changes.scrapPct, null);
  assert.equal(result.complete, false);
  const later = comparison.compare({month:'2026-10', mode:'year', production:[{date:'2026-10-02', shift:'А', tonnage:3000, brak:0}],
    baseProduction:[{date:'2025-10-02', shift:'А', tonnage:2000, brak:0}], now});
  assert.deepEqual(plain(later.changes.kg), {diff:1000, pct:50});
});
