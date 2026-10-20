const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {unzipText, slideText} = require('./pptx-zip.cjs');
const sandbox = vm.createContext({Intl, console, setTimeout, clearTimeout, Promise, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Blob, atob, btoa, Date, Math, JSON});
sandbox.window = sandbox; sandbox.self = sandbox;
for (const file of ['pptxgen-bundle', 'monthly-presentation-model', 'monthly-presentation-deck']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), sandbox);
const [presentation, deck, PptxGenJS] = vm.runInContext('[MonthlyPresentation, MonthlyPresentationDeck, PptxGenJS]', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));

// Fictional round figures; real monthly reports never belong in tests.
const report = (date, shift, autoKg, manKg, extra = {}) => ({date, shift, tonnage:autoKg + manKg, brak:0, breakdown:{autoKg, autoCrates:10, manKg, manCrates:5}, ...extra});
const production = [
  report('2026-09-02', 'А', 500000, 600000, {brak:20000}), report('2026-09-03', 'Б', 300000, 400000),
  {date:'2026-09-04', shift:'СТИКЕРИ', tonnage:100400, brak:0},
  report('2026-08-05', 'В', 900000, 1100000), report('2026-07-06', 'Г', 1000000, 1000000), report('2026-06-01', 'А', 5000, 5000)
];
const downtime = [{date:'2026-09-02', durationMin:180 * 60, reason:'Fictional material wait'}, {date:'2026-09-20', durationMin:30 * 60, reason:'Fictional changeover'},
  {date:'2026-09-21', durationMin:6 * 60, reason:'Fictional changeover'}, {date:'2026-08-31', durationMin:600, reason:'Fictional old stop'}];
const inputs = {profiles:'450000', dispatchedT:'1800', extrudedT:'2400', realizationT:'1900', anodizingT:'20', sawsT:'50', cncT:'30', specialT:'100',
  stations:'2', trucks:'6', trucksTarget:'8'};
// Fictional problems and roster counts; instants are UTC for readability.
const at = date => Date.parse(date + 'T12:00:00Z');
const problemItems = [
  {title:'Fictional old high', titleEn:'', impactLevel:'high', createdAt:at('2026-07-01'), resolvedAt:null, proposals:[{at:at('2026-09-10')}]},
  {title:'Фиктивен проблем', titleEn:'Fictional medium', impactLevel:'medium', createdAt:at('2026-09-05'), resolvedAt:null, proposals:[{at:at('2026-10-05')}]},
  {title:'Fictional resolved', impactLevel:'low', createdAt:at('2026-08-01'), resolvedAt:at('2026-09-20'), proposals:[]},
  {title:'Fictional later', impactLevel:'high', createdAt:at('2026-10-03'), resolvedAt:null, proposals:[]},
  {title:'Fictional resolved later', impactLevel:'low', createdAt:at('2026-09-01'), resolvedAt:at('2026-10-02'), proposals:[]}];
const period = {start:Date.parse('2026-09-01T00:00:00Z'), end:Date.parse('2026-10-01T00:00:00Z'), now:Date.parse('2026-10-20T00:00:00Z')};
const counts = {auto:{А:4, Б:3, В:0, Г:2}, manual:{А:2, Б:2, В:0, Г:1}, production:{А:6, Б:5, В:0, Г:3}, autoTotal:9, manualTotal:5, productionTotal:14, stickers:3, additional:1, totalActive:17};
const pairTeams = [{team:'А', reported:4, achieved:3, successPct:75, kgPct:96.4}, {team:'Б', reported:2, achieved:1, successPct:50, kgPct:88}];
const taskItems = [
  {due:at('2026-09-03'), status:'completed', report:{late:false}}, {due:at('2026-09-04'), status:'completed', report:{late:true}},
  {due:at('2026-09-05'), status:'not-done'}, {due:at('2026-09-06'), status:'pending', displayStatus:'unreported'}, {due:at('2026-09-29'), status:'in-progress'},
  {due:at('2026-09-07'), status:'cancelled'}, {due:at('2026-08-30'), status:'completed', report:{late:false}}];
const september = (extra = {}) => presentation.values({month:'2026-09', production, downtime, inputs, today:'2026-10-02', problemItems, period, counts, goalTons:2000, pairTeams, taskItems, ...extra});

test('site figures are the editable defaults and replacements flow into every derived figure', () => {
  assert.deepEqual(plain(presentation.siteFigures({month:'2026-09', production, downtime, goalTons:2000})), {cases:30, scrapT:20, downtimeH:216, goalT:2000, p1ScrapT:0, p1DowntimeH:10,
    autoT:800, manualT:1000, stickersT:100.4, p1AutoT:900, p1ManualT:1100, p1StickersT:0, p2AutoT:1000, p2ManualT:1000, p2StickersT:0});
  const v = september({inputs:{...inputs, autoT:'850', cases:'40', downtimeH:'72', p1AutoT:'1000'}});
  assert.deepEqual([v.packedT, v.autoT, v.cases, v.casesDay, v.mix[2].autoShare, v.mix[1].totalT, v.downtimeH, v.availability], ['1,950', '850', '40', '1.3', '43.6%', '2,100', '72', '90.0%']);
  assert.equal(v.scenarios[0].value, 850);
  assert.equal(september({inputs:{...inputs, autoT:''}}).autoT, '800');
});

test('performance: goal, change against last month, team pairs and tasks due in the month', () => {
  const v = september();
  assert.deepEqual(plain(v.goal), {goalT:'2,000', percent:'95%', ratio:0.9502, gap:'100 t below goal', met:false});
  assert.deepEqual(plain(v.comparison.map(row => [row.label, row.current, row.previous, row.change, row.trend, row.good])), [
    ['Packed tonnage', '1,900 t', '2,000 t', '-5.0%', 'down', false], ['Automatic line', '800 t', '900 t', '-11.1%', 'down', false],
    ['Manual packing', '1,000 t', '1,100 t', '-9.1%', 'down', false], ['Stickers', '100.4 t', '0.0 t', '—', 'flat', null],
    ['Scrap', '20.0 t', '0.0 t', '—', 'flat', null], ['Downtime', '216 h', '10 h', '+2060.0%', 'up', false]]);
  assert.deepEqual(plain(v.teams), [{team:'Team A', packedT:'1,100', pairs:'4', met:'75%', kg:'96%'}, {team:'Team B', packedT:'700', pairs:'2', met:'50%', kg:'88%'},
    {team:'Team C', packedT:'0', pairs:'0', met:'—', kg:'—'}, {team:'Team D', packedT:'0', pairs:'0', met:'—', kg:'—'}]);
  assert.deepEqual(plain(v.tasks), {total:5, completed:2, late:1, notDone:2, open:1, onTime:'20%'});
  assert.equal(september({taskItems:null}).tasks, null);
});

test('problems show the month-end state: counts, impact and the longest open, without authors', () => {
  const p = september().problems;
  assert.deepEqual([p.active, p.open, p.proposed, p.created, p.resolved], [3, 2, 1, 2, 1]);
  assert.deepEqual(plain(p.byImpact), [{level:'high', count:1}, {level:'medium', count:1}, {level:'low', count:1}]);
  assert.deepEqual(plain(p.oldest), [
    {title:'Fictional old high', level:'high', days:91, stage:'Solution proposed'},
    {title:'Fictional medium', level:'medium', days:25, stage:'Open'},
    {title:'Fictional resolved later', level:'low', days:29, stage:'Open'}]);
  assert.equal(presentation.values({month:'2026-09', production, downtime, period}).problems, null);
});

test('workforce compares team headcount with the team packed tonnage', () => {
  const f = september().workforce;
  assert.deepEqual([f.active, f.auto, f.manual, f.stickers, f.perPersonT], ['17', '9', '5', '3', '128.6']);
  assert.deepEqual(plain(f.teams.map(row => [row.team, row.people, row.packedT, row.perPersonT, row.perPerson])),
    [['Team A', 6, '1,100', '183.3', 183.3], ['Team B', 5, '700', '140.0', 140], ['Team C', 0, '0', '—', 0], ['Team D', 3, '0', '0.0', 0]]);
  assert.equal(presentation.values({month:'2026-09', production, downtime}).workforce, null);
});

test('monthly values add the packing routes and the reconciliation', () => {
  const v = september();
  assert.deepEqual([v.coverDate, v.monthName, v.monthShort, v.year], ['02.10.2026', 'September', 'Sep', '2026']);
  assert.deepEqual([v.packedT, v.autoT, v.manualT, v.stickersT, v.cases], ['1,900', '800', '1,000', '100.4', '30']);
  assert.deepEqual(plain(v.mix), [
    {name:'July', totalT:'2,000', autoShare:'50.0%', auto:1000, manual:1000, stickers:0},
    {name:'August', totalT:'2,000', autoShare:'45.0%', auto:900, manual:1100, stickers:0},
    {name:'September', totalT:'1,900', autoShare:'42.1%', auto:800, manual:1000, stickers:100.4}]);
  assert.deepEqual([v.calendarDays, v.workingDays, v.dispatchDay, v.profilesDay], ['30', '22', '81.8', '15,000']);
  // Scrap comes from the reports: 20 t + 100 t special production = 120 t outside the standard flow.
  assert.deepEqual([v.diffT, v.awaitingT, v.scrapT, v.outsideT, v.actualT, v.actualShare], ['500', '100', '20', '120', '280', '56%']);
});

test('automatic line utilization, scenarios and reasons follow downtime and stations', () => {
  const v = september();
  assert.deepEqual([v.calendarH, v.downtimeH, v.runningH, v.availability, v.downtimeShare], ['720', '216', '504', '70.0%', '30.0%']);
  assert.deepEqual([v.stations, v.stationLoading, v.effectiveUse], ['2', '40.0%', '28.0%']);
  assert.deepEqual(plain(v.scenarios.map(row => row.value)), [800, 2000, 1142.9, 2857.1]);
  assert.equal(v.scenarios[0].label, 'Actual\n504 h × 2');
  assert.deepEqual(plain(v.reasons), [{reason:'Fictional material wait', hours:'180', stops:1}, {reason:'Fictional changeover', hours:'36', stops:2}]);
  assert.deepEqual([v.trucksPerformance, v.trucksRatio, v.trucksGap, v.trucksUplift], ['75%', 0.75, '+2', '+33.3%']);
});

test('empty inputs and months stay visible as dashes, never as NaN', () => {
  const v = presentation.values({month:'2026-01', production:[], downtime:[], inputs:{}});
  assert.deepEqual(plain(v.mix.map(row => row.name)), ['November', 'December', 'January']);
  assert.deepEqual([v.profiles, v.extrudedT, v.stations, v.trucksGap, v.mix[2].autoShare, v.trucksRatio], ['—', '—', '—', '—', '—', 0]);
  assert.ok(!JSON.stringify(v).includes('NaN'));
  assert.deepEqual(plain(v.empty), {current:true, previous:true});
});

test('the deck has nine designed slides with the figures, native charts and editable text', async () => {
  const pptx = deck.build(PptxGenJS, september(), {improvements:['Fictional count: Stock checked twice.', '', 'Fictional scanners'], specialLabel:'Fictional line'});
  const files = unzipText(Buffer.from(await pptx.write({outputType:'arraybuffer'})));
  const slides = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => slideText(files[`ppt/slides/slide${n}.xml`]));
  const has = (n, lines) => { for (const line of lines) assert.ok(slides[n].includes(line), `slide ${n + 1} lacks "${line}": ${slides[n].join(' | ')}`); };
  assert.equal(files['ppt/slides/slide10.xml'], undefined);
  has(0, ['Packaging and Logistics Sector', 'September 2026', 'Prepared 02.10.2026']);
  has(1, ['1,900 t', '30 pcs', '450,000 pcs', '1,800 t', '81.8 t/day', 'Daily averages: packing totals ÷ 30 calendar days  |  dispatch ÷ 22 Mon–Fri working days']);
  has(2, ['Month Performance', '95%', '1,900 t of 2,000 t goal', '100 t below goal', '▼ -5.0%', 'Team A', '75%', '96%', '20% on time', '2 (1 late)']);
  has(3, ['Fictional line', '100 t', '280 t', '56% of the total difference · 500 − 100 − 120 = 280 t']);
  has(4, ['800 t', '1,000 t', '100.4 t', 'AL share 42.1%', 'PACKING MIX – JULY TO SEPTEMBER']);
  has(5, ['70.0%', '40.0%', '28.0%', '216 h', 'Fictional material wait', '36 h of downtime in 2 stops.']);
  has(6, ['Fictional count', 'Stock checked twice.', 'Fictional scanners', 'Add an improvement', '6 trucks/day', '+2 trucks/day', '+33.3%']);
  has(7, ['Global Problems', '3', '2 open · 1 with a proposed solution', 'Fictional old high', '91 days · Solution proposed', '8 / 9']);
  has(8, ['Workforce', '17 people', 'Team A', '1,100 t', '183.3', '—']);
  const charts = Object.keys(files).filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name)).map(name => files[name]);
  assert.equal(charts.length, 3);
  assert.ok(charts.some(xml => xml.includes('<c:grouping val="stacked"/>') && xml.includes('<c:v>100.4</c:v>')));
  assert.ok(charts.some(xml => xml.includes('<c:v>2857.1</c:v>')));
  assert.ok(Object.keys(files).some(name => name.startsWith('ppt/embeddings/')), 'charts keep editable data');
});
