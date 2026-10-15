/* Only fictional input and temporary SQLite/staging files. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {openStore,defaults}=require('../../server/store.cjs');
const {createImports}=require('../../server/imports.cjs');
const {createStatisticsReads}=require('../../server/statistics.cjs');
const {accepted,rejected}=require('../semantic-fixtures.cjs');
const user={id:1,role:'admin'}, clone=value=>JSON.parse(JSON.stringify(value));
function setup(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-semantic-demo-'));
  const filename=path.join(directory,'demo.sqlite'),store=openStore(filename),imports=createImports(store,filename);
  t.after(()=>{imports.close();store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const snapshot=()=>Object.fromEntries(['documents','report_versions','report_history','report_operations','files','audit','notification_targets'].map(table=>[table,store.db.prepare('SELECT * FROM '+table).all()]));
  return {directory,store,imports,snapshot};
}
const payload=(kind,data)=>({documents:{personnel:{employees:[]},[kind]:data},files:[],includeSettings:false});
for(const {name,kind,data} of rejected) test('server rejects '+name+' before any persisted change',t=>{
  const {directory,store,imports,snapshot}=setup(t),before=snapshot(),input=clone(data);
  const statistics=createStatisticsReads(store),prior=statistics.read(kind,'2026-10');
  assert.throws(()=>store.put(kind,input,1,user),{code:'INVALID_DATA'});
  assert.throws(()=>store.reportOperation(kind,{operationId:randomUUID(),action:'create',entryId:input.entries[0].id,entry:input.entries[0]},undefined,user),{code:'INVALID_DATA'});
  assert.throws(()=>imports.create(payload(kind,input),user),{code:'INVALID_DATA'});
  if(kind==='production-log') {
    assert.throws(()=>store.previewProductionImport(input,user),{code:'INVALID_DATA'});
    assert.throws(()=>store.applyProductionImport(input,1,user),{code:'INVALID_DATA'});
  }
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(statistics.read(kind,'2026-10'),prior);
  assert.deepEqual(fs.readdirSync(path.join(directory,'import-staging')),[]);
  assert.equal(fs.existsSync(path.join(directory,'import-backups')),false);
});
for(const {name,kind,data} of accepted) test('server preview and atomic import accept '+name,t=>{
  const {store,imports,snapshot}=setup(t),input=clone(data),before=snapshot();
  const id=imports.create(payload(kind,input),user).id,preview=imports.preview(id,user);
  assert.equal(preview.canApply,true); assert.deepEqual(snapshot(),before);
  imports.apply(id,preview.token,user);
  const saved=store.get(kind).data.entries[0];
  assert.deepEqual(saved,kind==='production-log'?{...input.entries[0],breakdown:input.entries[0].breakdown??null}:input.entries[0]);
  assert.deepEqual(data,input);
  const statistics=createStatisticsReads(store).read(kind,'2026-10').data;
  assert.deepEqual(statistics.entries,[saved]);
});
for(const {name,kind,data} of rejected) test('preview and apply recheck staged '+name+' atomically',t=>{
  const {directory,store,imports,snapshot}=setup(t);
  const valid=accepted.find(value=>value.kind===kind).data;
  const id=imports.create(payload(kind,valid),user).id,preview=imports.preview(id,user),before=snapshot();
  const file=path.join(directory,'import-staging',id,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  manifest.documents[kind]=clone(data);
  fs.writeFileSync(file,JSON.stringify(manifest));
  assert.throws(()=>imports.apply(id,preview.token,user),{code:'IMPORT_CONFLICT'});
  const checked=imports.preview(id,user);
  assert.equal(checked.canApply,false); assert.ok(checked.documents[kind].conflicts>0);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(store.get(kind).data,defaults[kind]);
  assert.equal(fs.existsSync(path.join(directory,'import-backups')),false);
});
