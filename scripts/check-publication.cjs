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
const git = (args,cwd=root) => execFileSync('git',args,{cwd,maxBuffer:32*1024*1024});
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
  return Object.hasOwn(fixtures,file) ||
    ['.gitignore','AGENTS.md','README.md','PUBLICATION-NOTES.md','LICENSE'].includes(file) ||
    /^[a-z][a-z0-9-]*\.html$/.test(file) ||
    /^(css|js|tests|scripts)\/[a-z0-9][a-z0-9./-]*\.(css|js|cjs)$/.test(file) ||
    /^\.githooks\/(pre-commit|pre-push)$/.test(file);
}
function inspect(file,buffer,tokens=[],mode='100644') {
  if(!['100644','100755'].includes(mode) || !allowedFile(file)) throw new Error('Unapproved file type or path: '+file);
  if(Object.hasOwn(fixtures,file)) {
    if(crypto.createHash('sha256').update(buffer).digest('hex') !== fixtures[file]) throw new Error('Approved demo fixture has changed: '+file);
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
function checkSnapshot(ref,tokens,cwd=root) {
  const entries = git(ref === '--staged' ? ['ls-files','--stage','-z'] : ['ls-tree','-r','-z',ref],cwd).toString('utf8').split('\0').filter(Boolean);
  let count = 0;
  for(const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode,second,third] = entry.slice(0,tab).split(' ');
    const file = entry.slice(tab+1);
    if(ref === '--staged' && third !== '0') throw new Error('Resolve index conflicts before publishing.');
    const hash = ref === '--staged' ? second : third;
    // Validate the path before reading a potentially large, unapproved document.
    if(!allowedFile(file)) throw new Error('Unapproved file type or path: '+file);
    inspect(file,git(['cat-file','blob',hash],cwd),tokens,mode);
    count++;
  }
  return count;
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
    for(const commit of commits) checkSnapshot(commit,tokens);
    console.log('Publication check passed for '+commits.length+' outgoing commits.');
  } else {
    console.log('Publication check passed for '+checkSnapshot('--staged',tokens)+' staged files.');
  }
}
module.exports = {fixtures,inspect,privateTokens,checkSnapshot,commitsForPush};
if(require.main === module) {
  try { main(); } catch(error) {
    console.error('PUBLICATION BLOCKED: '+error.message);
    process.exitCode = 1;
  }
}
