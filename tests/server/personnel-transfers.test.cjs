const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openStore,personnelModel}=require('../../server/store.cjs');
const {pairRoster,workforceCounts}=require('../../server/module-access.cjs');
const {createImports}=require('../../server/imports.cjs');
const user={id:1,role:'admin'};
const person={id:'demo-future-person',name:'Demo Future Person',category:'auto',team:'А',role:'Опаковчик',active:true,note:'Demo private note'};
const transfer={effectiveDate:'2026-10-14',category:'auto',team:'Г'};
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-transfer-test-')),filename=path.join(directory,'demo.sqlite');
  let at='2026-10-13T12:00:00Z';
  const options={personnelNow:()=>Date.parse(at)};
  const store=openStore(filename,options);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const data=store.get('personnel');store.put('personnel',{...data.data,employees:[person]},data.revision,user);
  return {store,filename,options,setTime:value=>{at=value;}};
}
function plan(store,value=transfer){const state=store.get('personnel');return store.put('personnel',{...state.data,schemaVersion:4,employees:[{...state.data.employees[0],transfers:value?[value]:[]}]},state.revision,user);}
test('future assignments persist across reopening without changing the baseline or a midnight revision',t=>{
  const {store,filename,options,setTime}=setup(t),state=plan(store);
  assert.equal(state.data.employees[0].team,'А');
  const reopened=openStore(filename,options);t.after(()=>reopened.close());
  assert.deepEqual(reopened.get('personnel').data.employees[0].transfers,[transfer]);
  setTime('2026-10-14T12:00:00Z');
  assert.equal(personnelModel.assignmentAt(reopened.get('personnel').data.employees[0],'2026-10-14').team,'Г');
  assert.equal(reopened.get('personnel').revision,state.revision);
});
test('today/past transfers and multiple pending plans are rejected without changing data',t=>{
  const {store}=setup(t),state=store.get('personnel');
  for(const transfers of [[{...transfer,effectiveDate:'2026-10-13'}],[transfer,{...transfer,effectiveDate:'2026-11-01',team:'А'}]]){
    assert.throws(()=>store.put('personnel',{...state.data,schemaVersion:4,employees:[{...person,transfers}]},state.revision,user));
    assert.deepEqual(store.get('personnel'),state);
  }
});
test('pending replacement and cancellation work; completed history and baseline cannot be rewritten',t=>{
  const {store,setTime}=setup(t);plan(store);plan(store,{effectiveDate:'2026-10-16',category:'stickers',team:'1 смяна'});plan(store,null);plan(store);
  setTime('2026-10-15T12:00:00Z'); const state=store.get('personnel');
  for(const employee of [{...person,transfers:[]},{...person,team:'Г',transfers:[transfer]}]){
    assert.throws(()=>store.put('personnel',{...state.data,employees:[employee]},state.revision,user));
    assert.deepEqual(store.get('personnel'),state);
  }
  const renamed={...state.data.employees[0],name:'Demo Renamed Future Person'};
  store.put('personnel',{...state.data,employees:[renamed]},state.revision,user);
});
test('raw immediate team changes and removing a planned person cannot bypass the dated flow',t=>{
  const {store}=setup(t);let state=store.get('personnel');
  assert.throws(()=>store.put('personnel',{...state.data,employees:[{...person,team:'Г'}]},state.revision,user));
  state=plan(store);
  assert.throws(()=>store.put('personnel',{...state.data,employees:[]},state.revision,user));
});
test('permission and revision checks protect transfer planning',t=>{
  const {store}=setup(t),state=store.get('personnel');plan(store);
  assert.throws(()=>store.put('personnel',state.data,state.revision,user),e=>e.code==='CONFLICT');
  assert.throws(()=>store.put('personnel',state.data,store.get('personnel').revision,{id:2,role:'operator'}),e=>e.status===403);
});
test('minimal pair rosters preserve assignments but never expose personnel notes or transfer metadata',()=>{
  const people=[{...person,transfers:[{...transfer,note:'Demo private transfer metadata'}]}];
  const roster=pairRoster(people);
  assert.equal(roster[0].note,undefined);assert.equal(roster[0].transfers[0].note,undefined);
  assert.deepEqual(roster[0].transfers,[transfer]);
  assert.equal(workforceCounts(people,'2026-10-13').auto['А'],1);
  assert.equal(workforceCounts(people,'2026-10-14').auto['А'],0);
  assert.equal(workforceCounts(people,'2026-10-14').auto['Г'],1);
});
test('imports retain schema 4 timelines and legacy duplicate imports do not erase plans',t=>{
  const {store,filename}=setup(t),imports=createImports(store,filename);t.after(()=>imports.close());
  const newPerson={...person,id:'demo-import-future',name:'Demo Imported Future Person',transfers:[transfer]};
  const id=imports.create({documents:{personnel:{schemaVersion:4,employees:[newPerson]}},files:[],includeSettings:false},user).id;
  let preview=imports.preview(id,user);assert.equal(preview.canApply,true);imports.apply(id,preview.token,user);
  const data=store.get('personnel').data;assert.equal(data.schemaVersion,4);assert.deepEqual(data.employees.find(p=>p.id===newPerson.id).transfers,[transfer]);
  const legacy=imports.create({documents:{personnel:{schemaVersion:3,employees:[{...newPerson,transfers:undefined}]}},files:[],includeSettings:false},user).id;
  preview=imports.preview(legacy,user);assert.ok(preview.documents.personnel.conflicts>0);assert.equal(preview.canApply,false);
  assert.deepEqual(store.get('personnel').data,data);
});
