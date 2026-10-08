const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const runner = path.resolve(__dirname, '../scripts/backup.sh');
function environment(t, scenario = 'success') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-backup-host-demo-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bin = path.join(dir, 'bin'), primary = path.join(dir, 'primary'), secondary = path.join(dir, 'secondary with spaces');
  for (const folder of [bin, primary, secondary]) fs.mkdirSync(folder, {mode: 0o700});
  const config = path.join(dir, 'config'), state = path.join(dir, 'commands');
  fs.writeFileSync(config, `DEPLOY_DIR='${dir}/demo-deploy'\nCOMPOSE_PROJECT=demo-hub\nPRIMARY_DIR='${primary}'\nSECONDARY_DIR='${secondary}'\nSECONDARY_MOUNT='${dir}/demo-mount'\nSECONDARY_UUID=fictional-disk-uuid\n`, {mode: 0o600});
  const mock = path.join(bin, 'boundary.cjs');
  fs.writeFileSync(mock, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),a=process.argv.slice(2),mode=process.env.DEMO_SCENARIO;
const state=process.env.DEMO_COMMANDS;
const commands=fs.existsSync(state)?JSON.parse(fs.readFileSync(state)):[];
commands.push([name,...a]);fs.writeFileSync(state,JSON.stringify(commands));
let out='',status=0;
if(name==='stat') {
  if(a[1]==='%u:%a') out=a[2]===process.env.DEMO_CONFIG?'0:600':'1000:700';
  else if(a[1]==='%d') out=a[2]===process.env.DEMO_PRIMARY||mode==='same-disk'?'1':'2';
} else if(name==='flock'&&mode==='locked') status=1;
else if(name==='mountpoint'&&mode==='missing-disk') status=1;
else if(name==='findmnt') out=a[1]==='UUID'?(mode==='replaced-disk'?'fictional-other-uuid':'fictional-disk-uuid'):process.env.DEMO_MOUNT;
else if(name==='docker') {
  if(a[0]==='compose') out=mode==='missing-app'?'':'c'.repeat(64);
  else if(a[0]==='inspect') {
    const f=a[2];
    if(f.includes('.State.Running')) out='true';
    else if(f.includes('.State.ExitCode')) out=mode==='worker-fails'?'1':'0';
    else if(f.includes('.Image')) out='sha256:'+'a'.repeat(64);
    else if(f.includes('.Config.Labels')) out='demo-hub';
    else if(f.includes('.Mounts')) out='demo-hub-data';
    else if(f.includes('.Config.Env')) out='/var/lib/package-hub/hub.sqlite';
  } else if(a[0]==='create') {
    if(mode==='orphan-worker') status=1;else out='d'.repeat(64);
  } else if(a[0]==='start'&&mode==='worker-fails') status=1;
} else if(name==='chown') status=0;
if(status) process.stderr.write('fictional-sensitive-configuration');
if(out) process.stdout.write(out+'\\n');process.exit(status);
`);
  fs.chmodSync(mock, 0o755);
  for (const command of ['stat', 'flock', 'mountpoint', 'findmnt', 'docker', 'chown']) fs.symlinkSync(mock, path.join(bin, command));
  return {primary, run(args = []) {
    const result = spawnSync('bash', [runner, ...args], {encoding: 'utf8', env: {...process.env, PATH: bin + path.delimiter + process.env.PATH, HUB_BACKUP_CONFIG: config, DEMO_SCENARIO: scenario, DEMO_COMMANDS: state, DEMO_CONFIG: config, DEMO_PRIMARY: primary, DEMO_MOUNT: path.join(dir, 'demo-mount')}});
    return {...result, commands: JSON.parse(fs.readFileSync(state))};
  }};
}
test('host worker uses the running image, a read-only existing volume and two explicit local directories', t => {
  const demo = environment(t), result = demo.run();
  assert.equal(result.status, 0, result.stdout);
  const create = result.commands.find(a => a[0] === 'docker' && a[1] === 'create');
  assert.ok(create.includes('type=volume,src=demo-hub-data,dst=/var/lib/package-hub,readonly'));
  for (const value of ['--network', 'none', '--read-only', '--pull', 'never', '--cap-drop', 'ALL', '1000:1000']) assert.ok(create.includes(value));
  assert.ok(create.some(value => value.includes('secondary with spaces,dst=/backup-secondary')));
  assert.ok(create.includes('sha256:' + 'a'.repeat(64)));
  assert.ok(result.commands.some(a => a[0] === 'docker' && a[1] === 'stop'));
  assert.ok(result.commands.some(a => a[0] === 'docker' && a[1] === 'rm'));
  assert.equal(fs.existsSync(path.join(demo.primary, 'host-failure')), false);
  assert.ok(!result.commands.some(a => a.includes('push') || a.includes('down') || a.includes('restart')));
});
for (const scenario of ['missing-disk', 'replaced-disk', 'same-disk', 'missing-app', 'worker-fails', 'orphan-worker']) {
  test(scenario + ' fails visibly, keeps previous backup files and suppresses private tool errors', t => {
    const demo = environment(t, scenario), previous = path.join(demo.primary, 'previous.sqlite');
    fs.writeFileSync(previous, 'Fictional previous backup boundary');
    const result = demo.run();
    assert.notEqual(result.status, 0, result.stdout + JSON.stringify(result.commands));
    assert.ok(!result.stderr.includes('fictional-sensitive-configuration'));
    assert.equal(fs.readFileSync(previous, 'utf8'), 'Fictional previous backup boundary');
    assert.ok(fs.existsSync(path.join(demo.primary, 'host-failure')));
    if (scenario === 'worker-fails') assert.ok(result.commands.some(a => a[0] === 'docker' && a[1] === 'stop'));
    if (['missing-disk', 'replaced-disk', 'same-disk'].includes(scenario)) assert.ok(!result.commands.some(a => a[0] === 'docker'));
  });
}
test('overlapping host runs do not start a worker or overwrite its status', t => {
  const demo = environment(t, 'locked'), result = demo.run();
  assert.equal(result.status, 0);
  assert.ok(!result.commands.some(a => a[0] === 'docker'));
  assert.equal(fs.existsSync(path.join(demo.primary, 'host-failure')), false);
});
test('status is read-only and remains available with a missing secondary disk', t => {
  const demo = environment(t, 'missing-disk'), result = demo.run(['status']);
  assert.equal(result.status, 0);
  assert.ok(!result.commands.some(a => a[0] === 'mountpoint' || a[0] === 'flock'));
  const run = result.commands.find(a => a[0] === 'docker' && a[1] === 'run');
  assert.ok(run.includes('type=bind,src=' + demo.primary + ',dst=/backup-primary,readonly'));
  assert.equal(run.at(-1), 'status');
});
