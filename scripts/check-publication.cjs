/* Scan the actual index / outgoing commits, without printing private values. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
// Fingerprints of the already-reviewed FICTIONAL fixtures, never private data.
const fixtures = {
  'data/archive/leave-management.json':'364b37738032a28a72829f4d2192b70bd9353c9ee8dddfc5b70c2785f995d6ac',
  'data/line-downtime.json':'0406247c77c246f64e676ce351afd45febcf9f3db66956769c3cc26d759d9970',
  'data/package-instructions.json':'660e8a07c5cc0a87e891d09febc1966a71dd00baae4a0f577ba057b7fded8c7a',
  'data/pair-targets.json':'b61883f8b17120952e4e696110f88fd0b8392b316d74adae04c28bd7486ea129',
  'data/personnel.json':'a17ada0b434506a359e7604808cff069a9f7d7239ca5dae2c7cda5d1c0f6cd6b',
  'data/production-log.json':'007a29961773979975c43d46f070fd2aad12b4efd17469c9c74dd115efc0ef4a',
  'data/profiles/demo-profile-001/instruction.txt':'098345f15b33c99a28ac61eaf91c0dea8b809a4008602dc948c8cfa9dc4232fd',
  'js/employees-seed.js':'3d94d043f1918159e8e7fc4b39cdb93515c1531ebe16bfb9d80c30dad9ea71da'
};
// Exact reviewed logo, README badges and opaque PNG exports only; no general image allowance.
const approvedAssets = {
  'assets/readme-badges.svg':'9a0a208c8975f6b8abfb9fc016e2e2af01d4751ceb1cf1f7fcad98a836413996',
  'assets/package-hub-mark.svg':'9820e0a8deccf0562f38808c1a1a6599c3cba3147dc773fb368624049a5368b6',
  'assets/package-hub-icon-180.png':'fdcf72603402137747a8076504c30af102a29ce21e9af1e86f78c041c2591025',
  'assets/package-hub-icon-192.png':'782f72e465dc23f10f4cf81fd5e7dadabfac357f6ae66b0fd36bd9ef651d9915',
  'assets/package-hub-icon-512.png':'2374da93159431bba2ce0bc63037603dd6f7e98abce13681b5be1f78cd600b32'
};
const MAX_BLOB_BYTES = 32*1024*1024;
const BATCH_BYTES = 8*1024*1024;
const BATCH_OBJECTS = 512;
const MAX_CACHED_CHECKS = 50000;
const git = (args,cwd=root,input,maxBuffer=MAX_BLOB_BYTES) => {
  try { return execFileSync('git',args,{cwd,input,maxBuffer,stdio:['pipe','pipe','pipe']}); }
  catch { throw new Error('Cannot safely read publication Git objects.'); }
};
function privateTokens(sourceRoot) {
  const tokens = new Set();
  const add = value => { if(typeof value === 'string' && value.trim().length >= 4) tokens.add(value.toLowerCase()); };
  const load = file => JSON.parse(fs.readFileSync(path.join(sourceRoot,file),'utf8'));
  if(!fs.existsSync(path.join(sourceRoot,'data/personnel.json'))) return [];
  const personnel = load('data/personnel.json');
  for(const person of personnel.employees || []) add(person.name);
  // Migration/settings entries use a generic system label, not an employee name.
  for(const move of personnel.moveLog || []) if(!['migration','settings'].includes(move.type)) add(move.name);
  const seed = fs.readFileSync(path.join(sourceRoot,'js/employees-seed.js'),'utf8');
  const seedData = seed.match(/const DEFAULT_EMPLOYEES\s*=\s*(\[.*?\]);/s);
  if(!seedData) throw new Error('Cannot inspect the private personnel reference safely.');
  for(const person of JSON.parse(seedData[1])) add(person.name);
  for(const entry of load('data/pair-targets.json').entries || []) for(const person of entry.members || []) add(person.name);
  for(const [key,entry] of Object.entries(load('data/package-instructions.json'))) {
    add(key);
    for(const field of ['number','name','client','folderName']) add(entry[field]);
  }
  const sync = fs.readFileSync(path.join(sourceRoot,'js/file-sync.js'),'utf8');
  const admin = sync.match(/const ADMIN_PASSWORD\s*=\s*(['"])(.*?)\1/);
  if(admin) add(admin[2]);
  const shifts = sync.match(/const SHIFT_PASSWORDS\s*=\s*\{(.*?)\};/s);
  if(shifts) for(const match of shifts[1].matchAll(/:\s*['"]([^'"]+)['"]/g)) add(match[1]);
  return [...tokens];
}
function allowedFile(file) {
  return Object.hasOwn(fixtures,file) || Object.hasOwn(approvedAssets,file) ||
    ['.gitignore','.dockerignore','Dockerfile','compose.yaml','compose.maintenance.yaml','AGENTS.md','README.md','GUIDE.md','PUBLICATION-NOTES.md','BACKUP-RECOVERY-SCENARIOS.md','SYSTEM-STATUS-SCENARIOS.md','SECURITY-REVIEW.md','LICENSE','manifest.webmanifest',
      'scripts/auto-update.sh','scripts/install-auto-update.sh',
      'scripts/package-hub-auto-update.service','scripts/package-hub-auto-update.timer',
      'scripts/backup.sh','scripts/install-backups.sh','scripts/restore-rehearsal.sh',
      'scripts/maintenance-host.py','scripts/install-maintenance.sh','scripts/package-hub-maintenance.socket','scripts/package-hub-maintenance.service','tests/maintenance-host-test.py',
      'scripts/package-hub-backup.service','scripts/package-hub-backup.timer'].includes(file) ||
    /^[a-z][a-z0-9-]*\.html$/.test(file) ||
    /^(css|js|tests|scripts|server)\/[a-z0-9][a-z0-9./-]*\.(css|js|cjs)$/.test(file) ||
    /^\.githooks\/(pre-commit|pre-push)$/.test(file);
}
function inspect(file,buffer,tokens=[],mode='100644') {
  if(!['100644','100755'].includes(mode) || !allowedFile(file)) throw new Error('Unapproved file type or path: '+file);
  if(Object.hasOwn(fixtures,file)) {
    if(crypto.createHash('sha256').update(buffer).digest('hex') !== fixtures[file]) throw new Error('Approved demo fixture has changed: '+file);
  }
  if(Object.hasOwn(approvedAssets,file) && crypto.createHash('sha256').update(buffer).digest('hex') !== approvedAssets[file]) throw new Error('Approved static asset has changed: '+file);
  // Binary logos are accepted only after the exact path, file mode and hash checks.
  if(Object.hasOwn(approvedAssets,file) && file.endsWith('.png')) {
    if(tokens.some(token => file.toLowerCase().includes(token))) throw new Error('Private source content detected in: '+file);
    return;
  }
  const text = buffer.toString('utf8');
  if(buffer.includes(0) || !Buffer.from(text,'utf8').equals(buffer)) throw new Error('Binary content is not approved: '+file);
  const lower = (file+'\n'+text).toLowerCase();
  if(tokens.some(token => lower.includes(token))) throw new Error('Private source content detected in: '+file);
  if(/\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text)) throw new Error('Credential material detected in: '+file);
  const admin = text.match(/const ADMIN_PASSWORD\s*=\s*(['"])(.*?)\1/);
  if(admin && admin[2] !== 'demo-admin') throw new Error('Only the public demo credential is allowed: '+file);
  const shifts = text.match(/const SHIFT_PASSWORDS\s*=\s*\{(.*?)\};/s);
  if(shifts && shifts[1].trim()) throw new Error('Shift credentials are not allowed: '+file);
}
function batchHeader(header,hash) {
  const match = /^([0-9a-f]{40,64}) blob (0|[1-9][0-9]*)$/.exec(header);
  if(!match || match[1] !== hash || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > MAX_BLOB_BYTES) throw new Error('Invalid or missing publication blob response.');
  return Number(match[2]);
}
function parseBatchResponse(buffer,objects) {
  let offset = 0;
  const contents = [];
  for(const {hash,size} of objects) {
    const newline = buffer.indexOf(10,offset);
    if(newline < offset || newline-offset > 100 || batchHeader(buffer.toString('utf8',offset,newline),hash) !== size) throw new Error('Incomplete or invalid publication blob response.');
    const start = newline+1, end = start+size;
    if(end >= buffer.length || buffer[end] !== 10) throw new Error('Incomplete publication blob content.');
    contents.push(buffer.subarray(start,end));
    offset = end+1;
  }
  if(offset !== buffer.length) throw new Error('Unexpected trailing publication blob response.');
  return contents;
}
function inspectBatch(pending,tokens,cwd,checked) {
  const hashes = [...pending.keys()];
  if(!hashes.length) return;
  const input = hashes.join('\n')+'\n';
  const headers = git(['cat-file','--batch-check'],cwd,input,BATCH_OBJECTS*128).toString('utf8').split('\n');
  if(headers.pop() !== '' || headers.length !== hashes.length) throw new Error('Incomplete publication blob metadata.');
  const objects = hashes.map((hash,index) => ({hash,size:batchHeader(headers[index],hash)}));
  let batch = [], bytes = 0;
  const flush = () => {
    if(!batch.length) return;
    const buffers = parseBatchResponse(git(['cat-file','--batch'],cwd,batch.map(object => object.hash).join('\n')+'\n',bytes+128*batch.length),batch);
    for(let index=0; index<batch.length; index++) for(const entry of pending.get(batch[index].hash)) {
      inspect(entry.file,buffers[index],tokens,entry.mode);
      // Keep only successful decisions, never blob content, and bound cache growth.
      if(checked.size >= MAX_CACHED_CHECKS) checked.clear();
      checked.add(entry.key);
    }
    batch = []; bytes = 0;
  };
  for(const object of objects) {
    if(batch.length && bytes+object.size > BATCH_BYTES) flush();
    batch.push(object); bytes += object.size;
  }
  flush();
}
function scanSnapshot(ref,tokens,cwd,checked) {
  const listing = git(ref === '--staged' ? ['ls-files','--stage','-z'] : ['ls-tree','-r','-z',ref],cwd);
  if(listing.length && listing[listing.length-1] !== 0) throw new Error('Incomplete publication snapshot listing.');
  const text = listing.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(listing)) throw new Error('Invalid publication snapshot encoding.');
  const entries = listing.length ? text.slice(0,-1).split('\0') : [];
  let count = 0;
  const pending = new Map();
  for(const entry of entries) {
    const tab = entry.indexOf('\t');
    const metadata = entry.slice(0,tab);
    const shape = ref === '--staged' ? /^([0-9]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/ : /^([0-9]{6}) (blob) ([0-9a-f]{40}|[0-9a-f]{64})$/;
    const fields = shape.exec(metadata);
    if(tab < 0 || !fields) throw new Error('Invalid publication snapshot entry.');
    const [,mode,second,third] = fields;
    const file = entry.slice(tab+1);
    if(ref === '--staged' && third !== '0') throw new Error('Resolve index conflicts before publishing.');
    const hash = ref === '--staged' ? second : third;
    // Validate the path before reading a potentially large, unapproved document.
    if(!allowedFile(file) || !['100644','100755'].includes(mode)) throw new Error('Unapproved file type or path: '+file);
    if(!/^[0-9a-f]{40,64}$/.test(hash)) throw new Error('Invalid publication object reference.');
    // Tokens and rules are fixed for this invocation; path and mode must also match.
    const key = JSON.stringify([file,mode,hash]);
    if(!checked.has(key)) {
      if(!pending.has(hash)) pending.set(hash,[]);
      pending.get(hash).push({file,mode,key});
      if(pending.size >= BATCH_OBJECTS) { inspectBatch(pending,tokens,cwd,checked); pending.clear(); }
    }
    count++;
  }
  inspectBatch(pending,tokens,cwd,checked);
  return count;
}
function checkSnapshots(refs,tokens,cwd=root) {
  const checked = new Set(), referenceTokens = [...tokens];
  return refs.map(ref => scanSnapshot(ref,referenceTokens,cwd,checked));
}
function checkSnapshot(ref,tokens,cwd=root) {
  return checkSnapshots([ref],tokens,cwd)[0];
}
function commitsForPush(input,cwd=root) {
  const commits = new Set();
  for(const line of input.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if(fields.length !== 4 || !/^[0-9a-f]{40,64}$/.test(fields[1]) || !/^[0-9a-f]{40,64}$/.test(fields[3])) throw new Error('Cannot validate outgoing Git references.');
    const local = fields[1], remote = fields[3];
    if(/^0+$/.test(local)) continue;
    const args = ['rev-list',local];
    if(!/^0+$/.test(remote)) {
      try { git(['cat-file','-e',remote+'^{commit}'],cwd); args.push('^'+remote); } catch { /* Check entire outgoing history if the remote object is absent locally. */ }
    }
    for(const hash of git(args,cwd).toString('utf8').trim().split('\n').filter(Boolean)) commits.add(hash);
  }
  return [...commits];
}
function main() {
  const sourceRoot = process.env.PACKAGE_HUB_PRIVATE_SOURCE || path.resolve(root,'../..');
  const tokens = privateTokens(sourceRoot);
  if(process.argv[2] === '--push') {
    const commits = commitsForPush(fs.readFileSync(0,'utf8'));
    checkSnapshots(commits,tokens);
    console.log('Publication check passed for '+commits.length+' outgoing commits.');
  } else {
    console.log('Publication check passed for '+checkSnapshot('--staged',tokens)+' staged files.');
  }
}
module.exports = {fixtures,approvedAssets,inspect,privateTokens,checkSnapshot,checkSnapshots,parseBatchResponse,commitsForPush};
if(require.main === module) {
  try { main(); } catch(error) {
    console.error('PUBLICATION BLOCKED: '+error.message);
    process.exitCode = 1;
  }
}
