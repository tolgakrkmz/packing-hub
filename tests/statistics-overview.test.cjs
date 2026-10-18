const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({Date, Intl});
for (const file of ['shift-schedule', 'pair-targets-model', 'statistics-overview']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), sandbox);
const [overview, schedule] = vm.runInContext('[StatisticsOverview, ShiftSchedule]', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const day = '2026-10-04';
const teams = schedule.TEAMS.filter(team => schedule.shiftInterval(team, day));
const end = team => schedule.shiftInterval(team, day).end;

test('picks today in the current month, otherwise the last reported day', () => {
  const production = [{date:'2026-09-03'}, {date:'2026-09-28'}, {date:'2026-10-01'}];
  assert.equal(overview.pickDay('2026-10', '2026-10-18', production), '2026-10-18');
  assert.equal(overview.pickDay('2026-09', '2026-10-18', production), '2026-09-28');
  assert.equal(overview.pickDay('2026-08', '2026-10-18', production), null);
});

test('day summary flags missing shifts, overdue pairs, high scrap and long downtime', () => {
  const [first, second, third] = teams.slice().sort((a, b) => schedule.shiftInterval(a, day).code - schedule.shiftInterval(b, day).code);
  const production = [
    {date:day, shift:first, tonnage:24000, brak:1200},
    {date:day, shift:second, tonnage:6000, brak:300},
    {date:'2026-10-02', shift:first, tonnage:30000, brak:300}
  ];
  const pairs = [
    {id:'p1', date:day, team:first, shiftCode:1, targetKg:1000, targetCrates:10, result:{kg:1000, crates:10}},
    {id:'p2', date:day, team:first, shiftCode:1, targetKg:1000, targetCrates:10, result:null},
    {id:'p3', date:day, team:third, shiftCode:3, targetKg:1000, targetCrates:10, result:null},
    {id:'p4', date:day, team:first, shiftCode:1, targetKg:1000, targetCrates:10, result:null, cancellation:{reasonKey:'cleaning'}}
  ];
  const downtime = [{date:day, shift:first, durationMin:75, reason:'Липса на материал'}, {date:day, shift:second, durationMin:20, reason:'Почистване'}];
  const result = overview.summarize({day, production, downtime, pairs, now:end(second) + 1});
  assert.deepEqual(plain(result.shifts.map(shift => [shift.team, shift.kg, shift.reported, shift.ended])), [[first, 24000, true, true], [second, 6000, true, true], [third, 0, false, false]]);
  assert.equal(result.kg, 30000);
  assert.equal(result.scrapPct, 5);
  assert.deepEqual(plain(result.pairs), {planned:3, achieved:1, missed:0, pending:2, overdue:1});
  assert.deepEqual(plain(result.downtime), {minutes:95, count:2, topReason:{reason:'Липса на материал', minutes:75}});
  assert.deepEqual(plain(result.attention.map(item => item.type)), ['overduePairs', 'highScrap', 'longDowntime']);
  const later = overview.summarize({day, production, downtime:[], pairs:[], now:end(third) + 1});
  assert.deepEqual(plain(later.attention.filter(item => item.type === 'missingShift')), [{type:'missingShift', team:third, code:3}]);
});

test('an empty day has no attention items', () => {
  const result = overview.summarize({day, now:0});
  assert.equal(result.kg, 0);
  assert.equal(result.scrapPct, null);
  assert.deepEqual(plain(result.attention), []);
  const none = overview.summarize({day:null, production:[{date:'2026-10-01', shift:'А', tonnage:1, brak:0}], pairs:[{date:'bad', team:'?', result:null}]});
  assert.deepEqual(plain([none.shifts, none.attention, none.kg]), [[], [], 0]);
});
