const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.TZ = 'Europe/Sofia';
const root = path.resolve(__dirname,'..');
const sandbox = vm.createContext({Date});
for(const file of ['shift-schedule','pair-targets-model']) vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),sandbox);
const schedule = vm.runInContext('ShiftSchedule',sandbox);
const model = vm.runInContext('PairTargets',sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const date = '2026-10-04';
const team = schedule.teamFor(schedule.parseDate(date),1);
const context = {date,shiftCode:1,team};
const employees = ['1','2','3','4'].map((id,index) => ({id,name:'Служител '+id,team,category:index % 2 ? 'manual' : 'auto',active:true}));
function plan(overrides = {}) {
  return model.plan({data:model.emptyData(),employees,context,memberIds:['1','2'],targetKg:'500.25',targetCrates:'20',workAreas:['auto','manual'],id:'pair-1',now:'2026-10-04T06:00:00Z',...overrides});
}
function report(overrides = {}, entry = plan()) {
  return model.report(entry,{context:entry,kg:'500.25',crates:'20',reasonKey:'',reasonText:'',workAreas:['auto','manual'],now:'2026-10-04T10:00:00Z',...overrides});
}
test('shift hours include exact boundaries and use the night shift start date',() => {
  for(const [time,expectedDate,shiftCode] of [
    ['2026-10-04T05:59:59','2026-10-03',3],['2026-10-04T06:00:00',date,1],
    ['2026-10-04T13:59:59',date,1],['2026-10-04T14:00:00',date,2],
    ['2026-10-04T21:59:59',date,2],['2026-10-04T22:00:00',date,3],
    ['2026-11-01T00:30:00','2026-10-31',3],['2027-01-01T00:00:00','2026-12-31',3]
  ]) {
    const current = schedule.current(new Date(time));
    assert.equal(current.date,expectedDate,time);
    assert.equal(current.shiftCode,shiftCode,time);
    assert.equal(current.team,schedule.teamFor(schedule.parseDate(expectedDate),shiftCode));
  }
});
test('shared rotation matches Personnel for every day, including daylight saving transitions',() => {
  const pattern = [3,3,3,3,'Н',2,2,2,2,'Н',1,1,1,1,'Н','Н'];
  const offsets = {'А':2,'Б':14,'В':6,'Г':10};
  const start = new Date(2026,0,1);
  for(let day = 0; day < 730; day++) {
    const at = new Date(start); at.setDate(at.getDate()+day);
    const elapsed = Math.round((Date.UTC(at.getFullYear(),at.getMonth(),at.getDate())-Date.UTC(2026,11,1))/86400000);
    for(const name of schedule.TEAMS) assert.equal(schedule.shiftCodeFor(name,at),pattern[((elapsed+offsets[name])%16+16)%16]);
    for(const code of [1,2,3]) assert.equal(schedule.TEAMS.filter(name => schedule.shiftCodeFor(name,at) === code).length,1);
  }
  assert.throws(() => schedule.parseDate('2026-02-30'));
});
test('two distinct active people, from the scheduled team, are required',() => {
  assert.throws(() => plan({memberIds:['1','1']}),/различни/);
  assert.throws(() => plan({memberIds:['1','missing']}),/активния/);
  assert.throws(() => plan({employees:employees.map(person => ({...person,active:false}))}),/активния/);
  assert.throws(() => plan({employees:employees.map(person => ({...person,team:'outside'}))}),/активния/);
  assert.throws(() => plan({context:{...context,shiftCode:2}}),/ротацията/);
});
test('a person cannot be assigned twice, including an already reported pair',() => {
  const entry = report();
  const data = {...model.emptyData(),entries:[entry]};
  assert.throws(() => plan({data,memberIds:['2','3'],id:'pair-2'}),/друга двойка/);
  assert.equal(plan({data,memberIds:['3','4'],id:'pair-2'}).id,'pair-2');
  const anotherDate = new Date(schedule.parseDate(date)); anotherDate.setDate(anotherDate.getDate()+16);
  assert.equal(plan({data,context:{...context,date:schedule.localDate(anotherDate)},id:'pair-2'}).id,'pair-2');
});
test('targets require positive numbers, and crates are whole numbers',() => {
  for(const value of ['',0,-1,' ','NaN',Infinity,true]) assert.throws(() => plan({targetKg:value}));
  for(const value of ['',0,-1,' ','1.5',Infinity,true]) assert.throws(() => plan({targetCrates:value}));
  assert.equal(plan().targetKg,500.25);
  assert.equal(plan().targetCrates,20);
});
test('both targets must be met; missing results are pending',() => {
  assert.equal(model.status(plan()),'pending');
  assert.equal(model.status(report()),'achieved');
  assert.equal(model.status(report({kg:600,crates:21})),'achieved');
  for(const values of [{kg:499,crates:20},{kg:600,crates:19},{kg:0,crates:0}]) {
    assert.throws(() => report(values),/причина/);
    const result = report({...values,reasonKey:'downtime'});
    assert.equal(model.status(result),'missed');
  }
});
test('preset and free text reasons are accepted, other requires explanation',() => {
  assert.equal(report({kg:0,reasonKey:'materials'}).result.reasonKey,'materials');
  assert.equal(report({kg:0,reasonText:'  Няма поръчка  '}).result.reasonText,'Няма поръчка');
  assert.throws(() => report({kg:0,reasonKey:'other'}),/причина/);
  assert.throws(() => report({kg:0,reasonText:'  '}),/причина/);
  assert.equal(report({reasonKey:'downtime',reasonText:'old'}).result.reasonText,'');
  for(const values of [{kg:''},{kg:' '},{kg:-1},{crates:1.5},{crates:''}]) assert.throws(() => report({...values,reasonKey:'downtime'}));
});
test('planning and reporting need no login, but the report must match the selected shift',() => {
  const entry = plan();
  assert.equal(entry.team,team);
  assert.equal(model.status(report({},entry)),'achieved');
  for(const wrong of [
    {...context,date:'2026-10-05'}, {...context,shiftCode:2},
    {...context,team:schedule.TEAMS.find(name => name !== team)},null
  ]) {
    assert.throws(() => report({context:wrong},entry),/избраната работна смяна/);
  }
});
test('temporary work areas never change personnel, historical names survive roster edits',() => {
  const original = JSON.stringify(employees);
  const entry = plan();
  assert.deepEqual(plain(entry.areas),['auto','manual']);
  assert.equal(JSON.stringify(employees),original);
  assert.deepEqual(plain(report({workAreas:['manual']},entry).areas),['manual']);
  assert.throws(() => plan({workAreas:[]}));
  assert.throws(() => report({workAreas:['stickers']}));
  const saved = {...model.emptyData(),entries:[entry]};
  const revised = plan({data:saved,employees:[],existingId:entry.id,targetKg:600});
  assert.equal(revised.members[0].name,employees[0].name);
  assert.throws(() => plan({data:saved,employees:[],existingId:entry.id,memberIds:['1','3']}));
  assert.equal(report({},entry).members[0].name,employees[0].name);
  assert.throws(() => plan({data:{...saved,entries:[report()]},existingId:entry.id}),/отчетена/);
});
test('data files reject other modules, malformed records and duplicates',() => {
  assert.equal(model.validateData(model.emptyData()).entries.length,0);
  for(const file of ['data/archive/leave-management.json','data/personnel.json','data/production-log.json']) assert.throws(() => model.validateData(JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))));
  const entry = plain(report());
  assert.equal(model.validateData({...model.emptyData(),entries:[entry]}).entries.length,1);
  for(const invalid of [
    [{...entry,targetKg:'500'}], [{...entry,date:'2026-02-30'}],
    [{...entry,members:[entry.members[0],entry.members[0]]}],
    [entry,{...entry,id:'pair-2'}],
    [{...entry,result:{...entry.result,kg:'500'}}],
    [{...entry,result:{...entry.result,kg:0,reasonKey:'',reasonText:''}}]
  ]) assert.throws(() => model.validateData({...model.emptyData(),entries:invalid}));
});
test('stickers use their active roster in first shift',() => {
  const people = employees.map(person => ({...person,team:'1 смяна',category:'stickers'}));
  assert.equal(plan({context:{...context,team:'СТИКЕРИ'},employees:people}).team,'СТИКЕРИ');
  assert.throws(() => plan({context:{...context,team:'СТИКЕРИ',shiftCode:2},employees:people}),/ротацията/);
});
