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
const employees = ['1','2','3','4'].map((id,index) => ({id,name:'Служител '+id,team,category:index % 2 ? 'manual' : 'auto',role:'Опаковчик',active:true}));
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
test('only active packers are available and can be added to new pairs in every category',() => {
  const excludedRoles = ['Началник смяна','Чемберовач','Кранист/чемберовач','Кранист','Оператор пулт 1','Оператор пулт 2','Обслужващ','Unknown','',undefined];
  for(const category of ['auto','manual','stickers']) {
    const scope = category === 'stickers' ? {...context,date:'2026-10-05',team:'СТИКЕРИ'} : context;
    const packers = employees.map(person => ({...person,category,role:'  ОПАКОВЧИК  ',team:category === 'stickers' ? '1 смяна' : team}));
    const others = excludedRoles.map((role,index) => ({...packers[0],id:'other-'+index,name:'Demo Other '+index,role}));
    const roster = [...packers,...others,{...packers[0],id:'inactive',active:false},
      {...packers[0],id:'wrong-group',team:'outside',category:category === 'stickers' ? 'auto' : 'stickers'}];
    const before = JSON.stringify(roster);
    assert.deepEqual(plain(model.roster(roster,scope.team)).map(person => person.id),['1','2','3','4']);
    assert.equal(plan({employees:roster,context:scope}).members[0].id,'1');
    for(const person of others) assert.throws(() => plan({employees:roster,context:scope,memberIds:['1',person.id]}),/активния/);
    assert.equal(JSON.stringify(roster),before);
  }
});
test('a role changed after opening a new pair prevents saving; saved history remains usable',() => {
  const entry = plan();
  const revisedRoster = employees.map(person => person.id === '1' ? {...person,role:'Чемберовач'} : person);
  assert.throws(() => plan({employees:revisedRoster}),/активния/);
  const historical = {...entry,members:entry.members.map(person => ({...person,role:'Началник смяна'}))};
  const data = {...model.emptyData(),entries:[historical]};
  assert.equal(model.validateData(data),data);
  assert.equal(model.status(report({},historical)),'achieved');
  assert.equal(plan({data,employees:[],existingId:entry.id,targetKg:600}).targetKg,600);
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
test('stickers use their active roster on weekdays and reject weekends',() => {
  const people = employees.map(person => ({...person,team:'1 смяна',category:'stickers'}));
  assert.equal(plan({context:{...context,date:'2026-10-05',team:'СТИКЕРИ'},employees:people}).team,'СТИКЕРИ');
  assert.throws(() => plan({context:{...context,team:'СТИКЕРИ'},employees:people}),/ротацията/);
  assert.throws(() => plan({context:{...context,team:'СТИКЕРИ',shiftCode:2},employees:people}),/ротацията/);
});
test('cancellation requires a preset or explained Other and preserves the original plan',() => {
  const entry = plan(), before = JSON.stringify(entry), now = '2026-10-04T07:00:00Z';
  const cancel = values => model.cancel(entry,{context,reasonKey:'cleaning',reasonText:'',now,...values});
  for(const reasonKey of ['left','cleaning','other-work','other']) {
    const cancelled = cancel({reasonKey,reasonText:'  Fictional explanation  '});
    assert.equal(model.status(cancelled),'cancelled');
    assert.equal(cancelled.cancellation.reasonText,'Fictional explanation');
    assert.equal(cancelled.updatedAt,now);
    for(const key of ['id','members','areas','targetKg','targetCrates','createdAt','result']) assert.deepEqual(plain(cancelled[key]),plain(entry[key]));
    assert.equal(model.validateData({...model.emptyData(),entries:[cancelled]}).entries.length,1);
  }
  for(const values of [{reasonKey:''},{reasonKey:'unknown'},{reasonKey:'other',reasonText:'  '},{reasonText:123},{reasonText:'x'.repeat(1001)},{now:'bad'},{now:'2026-02-30T07:00:00Z'},{context:{...context,shiftCode:2}}]) assert.throws(() => cancel(values));
  assert.equal(JSON.stringify(entry),before);
  assert.throws(() => model.cancel(report(),{context,reasonKey:'left',now}),/неотчетена/);
});
test('cancelled pairs release members for reassignment but cannot be edited or reported',() => {
  const entry = model.cancel(plan(),{context,reasonKey:'left',now:'2026-10-04T07:00:00Z'});
  const data = {...model.emptyData(),entries:[entry]};
  const replacement = plan({data,id:'pair-2'});
  assert.equal(model.validateData({...data,entries:[entry,replacement]}).entries.length,2);
  assert.equal(model.validateData({...data,entries:[replacement,entry]}).entries.length,2);
  assert.throws(() => plan({data,existingId:entry.id}),/Отменена/);
  assert.throws(() => report({},entry),/Отменена/);
  assert.throws(() => model.cancel(entry,{context,reasonKey:'cleaning',now:'2026-10-04T08:00:00Z'}));
  for(const cancellation of [false,'',0,[],{}, {...entry.cancellation,reasonKey:'unknown'}, {...entry.cancellation,reasonText:'  '}, {...entry.cancellation,extra:true}]) {
    assert.throws(() => model.validateData({...data,entries:[{...entry,cancellation}]}));
  }
  assert.throws(() => model.validateData({...data,entries:[{...entry,members:[entry.members[0],entry.members[0]]}]}));
  assert.throws(() => model.validateData({...data,entries:[{...entry,result:report().result}]}));
});
test('shift goal is always 30 t and without history the rest is split equally across unreported pairs',() => {
  assert.equal(model.SHIFT_GOAL_KG,30000);
  assert.equal(model.pairNorm(4),7500);
  assert.equal(model.pairNorm(0),0);
  const pair = (id,targetKg,extra = {}) => ({id,date,shiftCode:1,team,members:[{id:id+'1'},{id:id+'2'}],targetKg,result:null,...extra});
  const entries = [pair('a',4000),pair('b',3000),pair('c',5000,{result:{kg:5000}}),pair('d',9000,{cancellation:{}}),pair('e',3050)];
  // 30000 - 5000 reported = 25000 over 3 open pairs -> 8333.3, rounded up to 8400 each.
  const raised = model.equalize(entries,'2026-10-04T08:00:00Z');
  assert.deepEqual(plain(raised.map(entry => [entry.id,entry.targetKg])),[['a',8400],['b',8400],['e',8400]]);
  assert.ok(raised.every(entry => entry.updatedAt === '2026-10-04T08:00:00Z'));
  assert.deepEqual(plain(model.equalize([pair('a',15000),pair('b',15000)],'x')),[]);
  assert.deepEqual(plain(model.equalize([pair('a',1000,{result:{kg:1}})],'x')),[]);
});
test('history raises each pair in proportion to its people, keeps higher targets and skips downtime',() => {
  const shift = (day,shiftCode,ids,kg,reasonKey = '') => ({id:'h'+day+shiftCode+ids,date:'2026-09-'+String(day).padStart(2,'0'),shiftCode,team,members:ids.map(id => ({id})),targetKg:1,result:{kg,reasonKey}});
  const history = [shift(1,1,['p1','p2'],8000),shift(2,1,['p3','p4'],4000),shift(3,1,['p3','p4'],0,'downtime'),shift(4,1,['p3','p4'],0,'materials'),shift(5,1,['p3','p4'],4000,'quality')];
  const now = (members,targetKg) => ({id:members.join(''),date,shiftCode:1,team,members:members.map(id => ({id})),targetKg,result:null});
  const kg = list => plain(list.map(entry => [entry.id,entry.targetKg]));
  // Strengths 8000 and 4000 -> 30 t split 2:1.
  assert.deepEqual(kg(model.equalize([now(['p1','p2'],1000),now(['p3','p4'],1000)],'x',history)),[['p1p2',20000],['p3p4',10000]]);
  // Newcomers get the average of the known people in the shift (3000 each) -> strengths 8000, 4000, 6000.
  assert.deepEqual(kg(model.equalize([now(['p1','p2'],1000),now(['p3','p4'],1000),now(['p5','p6'],1000)],'x',history)),[['p1p2',13400],['p3p4',6700],['p5p6',10000]]);
  const strengths = model.pairStrengths([now(['p1','p2'],1),now(['p1','p6'],1)],history);
  assert.deepEqual(plain([...strengths.values()]),[{kg:8000,known:true},{kg:8000,known:false}]);
  // A supervisor target above the share stays; the others share the rest 8:6.
  assert.deepEqual(kg(model.equalize([now(['p1','p2'],1000),now(['p3','p4'],12000),now(['p5','p6'],1000)],'x',history)),[['p1p2',10300],['p5p6',7800]]);
  // Only the latest 10 shifts count, and the current shift is never history.
  const many = [...Array(12)].map((_,index) => shift(index+1,2,['p7','p8'],index < 2 ? 20000 : 2000));
  assert.deepEqual(plain(model.personAverages(many).get('p7')),{kg:1000,shifts:10});
  assert.equal(model.personAverages([{...many[0],date,shiftCode:1}],{date,shiftCode:1,team}).size,0);
});
