const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/restore-rehearsal.sh');
const image = 'sha256:' + 'a'.repeat(64);
const token = '00000000-0000-4000-8000-000000000001';
function environment(t, scenario = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-restore-host-demo-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  const archive = path.join(directory, 'fictional snapshot.sqlite'); fs.writeFileSync(archive, 'Fictional archive boundary');
  const state = path.join(directory, 'commands');
  const docker = path.join(bin, 'docker');
  fs.writeFileSync(docker, `#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2),mode=process.env.DEMO_SCENARIO;
const file=process.env.DEMO_COMMANDS,s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{commands:[],created:false};
s.commands.push(a);let out='',status=0;
if(a[0]==='run') out='${token}';
else if(a[0]==='volume') {
  if(a[1]==='inspect') {
    if(!s.created&&mode!=='existing-volume') status=1;
    else if(a.includes('--format')) out=mode==='wrong-owner'?'fictional-other-owner':'${token}';
  } else if(a[1]==='create') s.created=true;
} else if(a[0]==='create') out='c'.repeat(64);
else if(a[0]==='start'&&mode==='drill-fails') status=1;
else if(a[0]==='inspect') out=mode==='bad-exit'?'1':'0';
fs.writeFileSync(file,JSON.stringify(s));
if(status) process.stderr.write('fictional-private-infrastructure');
if(out) process.stdout.write(out+'\\n');process.exit(status);
`);
  fs.chmodSync(docker, 0o755);
  return {archive, run() {
    const result = spawnSync('bash', [script, archive, image], {encoding: 'utf8', env: {...process.env, PATH: bin + path.delimiter + process.env.PATH, DEMO_SCENARIO: scenario, DEMO_COMMANDS: state}});
    return {...result, commands: fs.existsSync(state) ? JSON.parse(fs.readFileSync(state)).commands : []};
  }};
}
test('restore drill mounts only a newly owned disposable volume and a read-only archive, with no network or published port', t => {
  const demo = environment(t), result = demo.run(); assert.equal(result.status, 0, result.stdout);
  const worker = result.commands.find(a => a[0] === 'create');
  assert.ok(worker.includes('type=volume,src=package-hub-restore-' + token + ',dst=/var/lib/package-hub'));
  assert.ok(worker.includes('type=bind,src=' + demo.archive + ',dst=/recovery-source.sqlite,readonly'));
  for (const flag of ['none', '--read-only', '--cap-drop', 'ALL', '1000:1000', 'never', image]) assert.ok(worker.includes(flag));
  assert.ok(!worker.includes('-p') && !worker.includes('--publish') && !worker.includes('--volumes-from'));
  assert.ok(result.commands.some(a => a[0] === 'stop'));
  assert.ok(result.commands.some(a => a[0] === 'volume' && a[1] === 'rm'));
  assert.equal(fs.readFileSync(demo.archive, 'utf8'), 'Fictional archive boundary');
});
test('host preflight rejects live database sidecars before a file-only bind could hide them', t => {
  const demo = environment(t);
  fs.writeFileSync(demo.archive + '-wal', 'Fictional live WAL sidecar');
  const result = demo.run(); assert.notEqual(result.status, 0); assert.deepEqual(result.commands, []);
});
for (const scenario of ['existing-volume', 'wrong-owner', 'drill-fails', 'bad-exit']) {
  test(scenario + ' fails without touching a pre-existing or differently owned volume', t => {
    const result = environment(t, scenario).run(); assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes('fictional-private-infrastructure'));
    if (['existing-volume', 'wrong-owner'].includes(scenario)) {
      assert.ok(!result.commands.some(a => a[0] === 'create' || a[0] === 'volume' && a[1] === 'rm'));
    } else {
      assert.ok(result.commands.some(a => a[0] === 'volume' && a[1] === 'rm'));
    }
  });
}
