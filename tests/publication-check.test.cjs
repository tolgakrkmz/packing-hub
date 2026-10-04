const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {fixtures,inspect,privateTokens,checkSnapshot,commitsForPush} = require('../scripts/check-publication.cjs');
const root = path.resolve(__dirname,'..');
const git = (cwd,args) => execFileSync('git',args,{cwd,stdio:['pipe','pipe','pipe']}).toString('utf8').trim();
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'publication-guard-'));
  git(dir,['init','-b','main']);
  git(dir,['config','user.name','Demo Tester']);
  git(dir,['config','user.email','demo@example.invalid']);
  return dir;
}
test('only unchanged, reviewed demo fixtures are accepted',() => {
  for(const file of Object.keys(fixtures)) {
    const content = fs.readFileSync(path.join(root,file));
    assert.doesNotThrow(() => inspect(file,content));
    assert.throws(() => inspect(file,Buffer.concat([content,Buffer.from(' ')])),/fixture has changed/);
  }
});
test('documents, backups, unknown data files and symlinks are blocked',() => {
  for(const file of ['data/personnel-copy.json','data/profiles/company.pdf','backup/report.json','private/config.js','js/archive.zip']) {
    assert.throws(() => inspect(file,Buffer.from('synthetic test')),/Unapproved/);
  }
  assert.throws(() => inspect('js/example.js',Buffer.from('synthetic'),[],'120000'),/Unapproved/);
  assert.throws(() => inspect('js/example.js',Buffer.from([0,1,2])),/Binary/);
});
test('private reference matches stop publication without revealing the value',() => {
  const syntheticToken = 'Synthetic Restricted Example';
  assert.throws(() => inspect('js/example.js',Buffer.from(syntheticToken),[syntheticToken.toLowerCase()]),error => {
    assert.ok(!error.message.includes(syntheticToken));
    return /Private source content/.test(error.message);
  });
});
test('local reference inspection distinguishes system migration labels from employee names',() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'publication-reference-'));
  try {
    fs.mkdirSync(path.join(dir,'data')); fs.mkdirSync(path.join(dir,'js'));
    const write = (file,value) => fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
    write('data/personnel.json',{employees:[{name:'Synthetic Employee'}],moveLog:[{type:'migration',name:'Synthetic System Label'},{type:'create',name:'Synthetic Former Employee'}]});
    write('data/pair-targets.json',{entries:[]});
    write('data/package-instructions.json',{});
    fs.writeFileSync(path.join(dir,'js/employees-seed.js'),'const DEFAULT_EMPLOYEES = [];');
    fs.writeFileSync(path.join(dir,'js/file-sync.js'),'');
    const tokens = privateTokens(dir);
    assert.ok(tokens.includes('synthetic employee'));
    assert.ok(tokens.includes('synthetic former employee'));
    assert.ok(!tokens.includes('synthetic system label'));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('non-demo credentials and secret key markers are blocked',() => {
  const admin = ['const ADMIN_','PASSWORD = "synthetic-only";'].join('');
  const shifts = ['const SHIFT_','PASSWORDS = {"demo":"synthetic-only"};'].join('');
  const marker = ['-----BEGIN ','PRIVATE KEY-----'].join('');
  const token = ['ghp','_','z'.repeat(30)].join('');
  for(const content of [admin,shifts,marker,token]) assert.throws(() => inspect('js/example.js',Buffer.from(content)),/credential|Credential/);
});
test('the staged content is checked even if the working file was cleaned afterwards',() => {
  const dir = repo();
  try {
    fs.mkdirSync(path.join(dir,'js'));
    const file = path.join(dir,'js/example.js');
    fs.writeFileSync(file,'Synthetic Restricted Example');
    git(dir,['add','js/example.js']);
    fs.writeFileSync(file,'Safe example code');
    assert.throws(() => checkSnapshot('--staged',['synthetic restricted example'],dir),/Private source/);
    git(dir,['add','js/example.js']);
    assert.equal(checkSnapshot('--staged',['synthetic restricted example'],dir),1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('push scanning includes an unsafe older commit even when the tip is clean',() => {
  const dir = repo();
  try {
    fs.mkdirSync(path.join(dir,'js'));
    const file = path.join(dir,'js/example.js');
    fs.writeFileSync(file,'Safe example code');git(dir,['add','.']);git(dir,['commit','-m','Safe baseline']);
    const baseline = git(dir,['rev-parse','HEAD']);
    fs.writeFileSync(file,'Synthetic Restricted Example');git(dir,['add','.']);git(dir,['commit','-m','Synthetic unsafe example']);
    fs.writeFileSync(file,'Safe example code');git(dir,['add','.']);git(dir,['commit','-m','Clean tip']);
    const tip = git(dir,['rev-parse','HEAD']);
    const commits = commitsForPush(`refs/heads/feature ${tip} refs/heads/feature ${baseline}\n`,dir);
    assert.equal(commits.length,2);
    assert.equal(checkSnapshot(tip,['synthetic restricted example'],dir),1);
    assert.ok(commits.some(commit => {
      try { checkSnapshot(commit,['synthetic restricted example'],dir); return false; } catch { return true; }
    }));
    assert.throws(() => commitsForPush('invalid references',dir),/validate outgoing/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
