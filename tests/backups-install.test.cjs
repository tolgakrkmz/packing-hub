const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/install-backups.sh');
function environment(t, scenario = 'success', preflight = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-backup-install-demo-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const bin = path.join(directory, 'bin'), root = path.join(directory, 'staged-root');
  const deploy = path.join(directory, "demo deploy 'quoted' $(fictional)"), primary = path.join(directory, 'primary'), secondary = path.join(directory, 'secondary');
  for (const folder of [bin, root, deploy, primary, secondary]) fs.mkdirSync(folder, {mode: 0o700});
  fs.writeFileSync(path.join(deploy, 'compose.yaml'), 'Fictional deployment boundary');
  fs.writeFileSync(path.join(deploy, '.env'), 'Fictional configuration boundary');
  const commands = path.join(directory, 'commands'), boundary = path.join(bin, 'boundary.cjs');
  fs.writeFileSync(boundary, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),name=path.basename(process.argv[1]),a=process.argv.slice(2),mode=process.env.DEMO_SCENARIO;
const file=process.env.DEMO_COMMANDS,list=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];
list.push([name,...a]);fs.writeFileSync(file,JSON.stringify(list));let out='',status=0;
if(name==='id') out=mode==='non-root'?'1000':'0';
else if(name==='realpath') out=a.at(-1);
else if(name==='stat') out=a[1]==='%u:%a'?(mode==='public-directory'?'1000:755':'1000:700'):(a[2]===process.env.DEMO_PRIMARY||mode==='same-disk'?'1':'2');
else if(name==='findmnt') out=a[1]==='UUID'?(mode==='missing-uuid'?'':'fictional-disk-uuid'):(mode==='root-mount'?'/':process.env.DEMO_MOUNT);
else if(name==='mountpoint'&&mode==='missing-mount') status=1;
else if(name==='docker') {
  if(a[0]==='compose') out=mode==='missing-app'?'':'c'.repeat(64);
  else if(a[0]==='inspect') out=a[2].includes('working_dir')?(mode==='wrong-project'?'/fictional/other-project':process.env.DEMO_DEPLOY):'demo-hub';
  else if(a[0]==='exec') { if(a.includes('id')) out=mode==='root-app'?'0':'1000'; else if(mode==='unsupported-image') status=1; }
} else if(name==='install') status=1; // Preflight tests can never write to /etc.
else if(name==='systemctl'&&((mode==='reload-fails'&&a[0]==='daemon-reload')||(mode==='first-backup-fails'&&a[0]==='start')||(mode==='enable-fails'&&a[0]==='enable'))) status=1;
if(status) process.stderr.write('fictional-private-host-error');
if(out) process.stdout.write(out+'\\n');process.exit(status);
`);
  fs.chmodSync(boundary, 0o755);
  const tools = preflight ? ['id', 'realpath', 'stat', 'findmnt', 'mountpoint', 'flock', 'docker', 'install', 'systemctl'] : ['systemctl'];
  for (const name of tools) fs.symlinkSync(boundary, path.join(bin, name));
  const env = {...process.env, PATH: bin + path.delimiter + process.env.PATH, DEMO_SCENARIO: scenario, DEMO_COMMANDS: commands,
    DEMO_DEPLOY: deploy, DEMO_PRIMARY: primary, DEMO_MOUNT: path.join(directory, 'fictional-mount')};
  return {root, deploy, primary, secondary, run(hours = '4') {
    // Source the same installation function with a temporary root, leaving the
    // CLI's root-only preflight and hardcoded system root unchanged.
    const staged = `set -Eeuo pipefail; umask 077; exec 2>/dev/null
source "$1"
deploy_dir=$3; primary_dir=$4; secondary_dir=$5; secondary_mount=$6
secondary_uuid=fictional-disk-uuid; project=demo-hub; hours=$7
install_service "$(dirname "$1")" "$2"`;
    const args = preflight ? [script, deploy, primary, secondary, hours] : ['-c', staged, 'demo-install', script, root, deploy, primary, secondary, env.DEMO_MOUNT, hours];
    const result = spawnSync('bash', args, {env, encoding: 'utf8'});
    return {...result, commands: fs.existsSync(commands) ? JSON.parse(fs.readFileSync(commands)) : []};
  }};
}
for (const hours of ['1', '2', '3', '4', '6', '8', '12', '24']) {
  test('staged installer writes a private escaped configuration and enables the ' + hours + '-hour timer only after a successful first backup', t => {
    const demo = environment(t), result = demo.run(hours); assert.equal(result.status, 0, result.stdout);
    const config = path.join(demo.root, 'etc/package-hub-backup.conf');
    assert.equal(fs.statSync(config).mode & 0o777, 0o600);
    const parsed = spawnSync('bash', ['-c', 'source "$1"; printf "%s\\0" "$DEPLOY_DIR" "$PRIMARY_DIR" "$SECONDARY_DIR" "$COMPOSE_PROJECT" "$SECONDARY_UUID"', 'demo-read', config], {encoding: 'utf8'});
    assert.equal(parsed.status, 0); assert.equal(parsed.stderr, '');
    assert.deepEqual(parsed.stdout.split('\0').slice(0, -1), [demo.deploy, demo.primary, demo.secondary, 'demo-hub', 'fictional-disk-uuid']);
    assert.equal(fs.readFileSync(path.join(demo.root, 'etc/systemd/system/package-hub-backup.timer.d/schedule.conf'), 'utf8'), '[Timer]\nOnCalendar=\nOnCalendar=*-*-* 00/' + hours + ':00:00 UTC\n');
    assert.deepEqual(result.commands, [['systemctl', 'daemon-reload'], ['systemctl', 'start', 'package-hub-backup.service'], ['systemctl', 'enable', '--now', 'package-hub-backup.timer']]);
    for (const file of ['package-hub-backup.service', 'package-hub-backup.timer']) assert.deepEqual(fs.readFileSync(path.join(demo.root, 'etc/systemd/system', file)), fs.readFileSync(path.resolve(__dirname, '../scripts', file)));
    const installed = path.join(demo.root, 'usr/local/libexec/package-hub-backup.sh');
    assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.resolve(__dirname, '../scripts/backup.sh')));
    assert.equal(fs.statSync(installed).mode & 0o777, 0o755);
  });
}
for (const scenario of ['reload-fails', 'first-backup-fails', 'enable-fails']) {
  test('installer ' + scenario + ' fails without claiming an enabled working schedule', t => {
    const demo = environment(t, scenario), result = demo.run();
    assert.notEqual(result.status, 0); assert.ok(!result.stdout.includes('schedule is enabled')); assert.equal(result.stderr, '');
    if (scenario !== 'enable-fails') assert.ok(!result.commands.some(a => a[1] === 'enable'));
    if (scenario === 'reload-fails') assert.ok(!result.commands.some(a => a[1] === 'start'));
    assert.ok(!fs.readdirSync(path.join(demo.root, 'etc')).some(name => name.startsWith('package-hub-backup.conf.')));
  });
}
for (const scenario of ['non-root', 'public-directory', 'missing-uuid', 'root-mount', 'missing-mount', 'same-disk', 'missing-app', 'wrong-project', 'root-app', 'unsupported-image']) {
  test('installer preflight refuses ' + scenario + ' before any system installation', t => {
    const result = environment(t, scenario, true).run();
    assert.notEqual(result.status, 0); assert.equal(result.stderr, '');
    assert.ok(!result.commands.some(a => a[0] === 'install' || a[0] === 'systemctl'));
  });
}
test('installer refuses an unsupported interval before installing or contacting the application', t => {
  const result = environment(t, 'success', true).run('5');
  assert.notEqual(result.status, 0);
  assert.ok(!result.commands.some(a => ['install', 'systemctl', 'docker'].includes(a[0])));
});
