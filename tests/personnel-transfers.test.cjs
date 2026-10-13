const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({Date, Intl});
for (const file of ['shift-schedule','personnel-model','pair-targets-model','data-validation']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),context);
const model = vm.runInContext('PersonnelModel',context), schedule = vm.runInContext('ShiftSchedule',context), validation = vm.runInContext('HubDataValidation',context);
const plain = value => JSON.parse(JSON.stringify(value));
const person = {id:'demo-transfer',name:'Demo Transfer Person',category:'auto',team:'А',role:'Опаковчик',active:true,note:'Demo note'};
const transfer = (effectiveDate,team='Г',category='auto') => ({effectiveDate,category,team});

test('dated assignments keep the baseline and survive normalization without changing the source', () => {
  const input = {...person,transfers:[transfer('2026-10-14')]}, before = JSON.stringify(input);
  assert.equal(model.assignmentAt(input,'2026-10-13').team,'А');
  assert.equal(model.assignmentAt(input,'2026-10-14').team,'Г');
  assert.equal(model.assignmentAt(input,'2027-01-01').team,'Г');
  assert.deepEqual(plain(model.normalizeEmployee(input).transfers),input.transfers);
  assert.equal(JSON.stringify(input),before);
});
test('six working start dates across the transition are allowed; seven require a rest date', () => {
  // A works Oct 12–13, then G Oct 14–17: six. A Oct 17–19 plus G Oct 20–23: seven.
  const six = model.assessTransfer(person,transfer('2026-10-14'));
  assert.equal(six.valid,true); assert.equal(six.longestRun,6);
  assert.equal(six.restHours,0); // last old night ends 06:00, first new starts at 06:00; no general 12h rule.
  const seven = model.assessTransfer(person,transfer('2026-10-20'));
  assert.equal(seven.valid,false); assert.equal(seven.reason,'consecutive'); assert.equal(seven.longestRun,7);
});
test('completed transfer work also counts before a new transfer', () => {
  const input = {...person,transfers:[transfer('2026-10-14')]};
  // A Oct 12–13, G Oct 14–15, A Oct 16 rest: valid; G Oct 14–17 followed by A Oct 18–20 makes nine.
  const valid = model.assessTransfer(input,transfer('2026-10-16','А'));
  assert.equal(valid.valid,true);
  const invalid = model.assessTransfer(input,transfer('2026-10-18','А'));
  assert.equal(invalid.valid,false); assert.equal(invalid.reason,'consecutive');
});
test('replacement and cancellation preserve completed history, reject past dates and inactive plans', () => {
  const input = model.changeTransfer(person,transfer('2026-10-14'),'2026-10-13');
  const next = model.changeTransfer(input,transfer('2026-10-16','1 смяна','stickers'),'2026-10-13');
  assert.equal(next.transfers.length,1); assert.equal(next.transfers[0].effectiveDate,'2026-10-16');
  assert.deepEqual(plain(model.changeTransfer(next,null,'2026-10-13').transfers),[]);
  const later = model.changeTransfer(input,transfer('2026-11-01','А'),'2026-10-18');
  assert.deepEqual(plain(model.changeTransfer(later,null,'2026-10-18').transfers),plain(input.transfers));
  assert.throws(()=>model.changeTransfer(person,transfer('2026-10-13'),'2026-10-13'));
  assert.throws(()=>model.changeTransfer({...person,active:false},transfer('2026-10-14'),'2026-10-13'));
});
test('candidate counts use one fixed window and recommend the earliest permitted no-loss date', () => {
  const result = model.transferOptions(person,{category:'manual',team:'А'},'2026-10-14');
  assert.equal(result.startDate,'2026-10-14'); assert.equal(result.endDate,'2026-12-16');
  assert.equal(result.baselineDays,48); assert.equal(result.candidates.length,32);
  assert.equal(result.recommendedDate,'2026-10-14');
  assert.ok(result.candidates.every(row=>row.valid && row.delta===0 && row.workingDays===48));
});
test('Stickers comparison reports unavoidable lost days rather than promising wages', () => {
  const result = model.transferOptions(person,{category:'stickers',team:'1 смяна'},'2026-10-14');
  assert.ok(result.candidates.some(row=>row.valid));
  const selected = result.candidates.find(row=>row.effectiveDate===result.recommendedDate);
  assert.ok(selected.valid); assert.ok(selected.delta<0);
  assert.equal(selected.delta,Math.max(...result.candidates.filter(row=>row.valid).map(row=>row.delta)));
});
test('all rotation and Stickers directions produce only candidates with at most six consecutive dates', () => {
  const assignments = ['А','Б','В','Г'].map(team=>({category:'auto',team})).concat({category:'stickers',team:'1 смяна'});
  for(const source of assignments) for(const target of assignments) if(source.team!==target.team) {
    const result = model.transferOptions({...person,...source},target,'2026-10-14');
    assert.equal(result.candidates.length,32);
    for(const row of result.candidates.filter(row=>row.valid)) assert.ok(row.longestRun<=6);
  }
});
test('malformed dates, assignments, unsorted timelines and seventh-day histories are rejected', () => {
  assert.equal(model.validateTransfers({...person,transfers:[transfer('2026-10-14')]}),true);
  for(const transfers of [null,{},[transfer('2026-02-30')],[transfer('2026-10-14','invalid')],
    [transfer('2026-10-14'),transfer('2026-10-14')],[transfer('2026-10-20')],
    Array.from({length:257},()=>transfer('2026-10-14'))]) assert.throws(()=>model.validateTransfers({...person,transfers}));
  assert.throws(()=>model.assignmentAt(person,'wrong'));
  assert.throws(()=>model.transferOptions(person,{category:'stickers',team:'А'},'2026-10-14'));
});
test('schema 4 preserves valid timelines while older schemas cannot hide transfer fields', () => {
  const input = {schemaVersion:4,employees:[{...person,transfers:[transfer('2026-10-14')]}]};
  assert.equal(validation.validate('personnel',input),input);
  for(const schemaVersion of [undefined,1,2,3,5]) assert.throws(()=>validation.validate('personnel',{...input,schemaVersion}));
  assert.throws(()=>validation.validate('personnel',{...input,employees:[{...person,transfers:[transfer('2026-10-20')]}]}));
});
test('calendar stepping and Sofia night intervals handle leap days, year boundaries and DST', () => {
  assert.equal(schedule.addDays('2028-02-28',1),'2028-02-29');
  assert.equal(schedule.addDays('2026-12-31',1),'2027-01-01');
  assert.equal(schedule.sofiaDate(new Date('2026-10-13T21:30:00Z')),'2026-10-14');
  const fall = schedule.shiftInterval('В','2026-10-24');
  assert.ok(fall); assert.equal((fall.end-fall.start)/3600000,9);
  assert.equal(schedule.addDays('2026-10-24',1),'2026-10-25');
  assert.equal(schedule.addDays('2026-03-28',1),'2026-03-29');
});
test('inactive people have no permissible recommended transfer date', () => {
  const result=model.transferOptions({...person,active:false},{category:'manual',team:'А'},'2026-10-14');
  assert.equal(result.recommendedDate,null);
  assert.ok(result.candidates.every(row=>!row.valid));
});
test('pair planning resolves the roster on the production date and retains saved members', () => {
  const pairs=vm.runInContext('PairTargets',context),employee={...person,transfers:[transfer('2026-10-14')]};
  assert.equal(pairs.roster([employee],'А','2026-10-13').length,1);
  assert.equal(pairs.roster([employee],'А','2026-10-14').length,0);
  assert.equal(pairs.roster([employee],'Г','2026-10-14').length,1);
  const second={...employee,id:'demo-transfer-two',name:'Demo Transfer Two'};
  const entry=pairs.plan({data:pairs.emptyData(),employees:[employee,second],context:{date:'2026-10-14',team:'Г',shiftCode:1},memberIds:[employee.id,second.id],targetKg:1,targetCrates:1,workAreas:['auto'],id:'demo-future-pair',now:'2026-10-14T03:00:00Z'});
  assert.equal(entry.members[0].id,employee.id);
  const preserved=pairs.plan({data:{...pairs.emptyData(),entries:[entry]},employees:[],context:entry,existingId:entry.id,memberIds:[employee.id,second.id],targetKg:2,targetCrates:1,workAreas:['auto'],id:entry.id,now:'2026-10-15T10:00:00Z'});
  assert.deepEqual(plain(preserved.members),plain(entry.members));
  assert.equal(pairs.report(entry,{context:entry,kg:1,crates:1,workAreas:['auto'],now:'2026-10-14T10:00:00Z'}).result.kg,1);
});

test('Sofia day refresh retries a transient read failure before accepting the day', async () => {
  const source=fs.readFileSync(path.join(__dirname,'../js/statistics.js'),'utf8');
  const refresh=source.slice(source.indexOf('let renderedStatisticsDay='),source.indexOf('setInterval(refreshStatisticsDay'));
  let day='2026-10-13',reads=0,renders=0;
  const clock=vm.createContext({statisticsDay:()=>day,document:{hidden:false},periodPending:false,HubServer:{},
    personnelSync:{refreshFromDisk:async()=>{reads++;if(reads===1)throw new Error('Demo transient read failure');}},renderAll:()=>{renders++;}});
  vm.runInContext(refresh,clock);day='2026-10-14';
  await vm.runInContext('refreshStatisticsDay()',clock);assert.equal(renders,0);
  await vm.runInContext('refreshStatisticsDay()',clock);assert.equal(reads,2);assert.equal(renders,1);
  await vm.runInContext('refreshStatisticsDay()',clock);assert.equal(reads,2);assert.equal(renders,1);
});
