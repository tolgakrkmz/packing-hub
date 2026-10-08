const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/install-maintenance.sh');

function fixture(t, mode = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-maintenance-install-fictional-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'root'), bin = path.join(directory, 'bin'), commands = path.join(directory, 'commands');
  for (const folder of [bin, path.join(root, 'etc/systemd/system'), path.join(root, 'usr/local/libexec')]) fs.mkdirSync(folder, {recursive: true});
  for (const file of ['etc/package-hub-backup.conf', 'etc/systemd/system/package-hub-backup.service', 'usr/local/libexec/package-hub-backup.sh']) fs.writeFileSync(path.join(root, file), 'Fictional existing installation', {mode: 0o600});
  const boundary = path.join(bin, 'boundary.cjs');
  fs.writeFileSync(boundary, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),name=path.basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.FICTIONAL_INSTALL_MODE;
const file=process.env.FICTIONAL_INSTALL_COMMANDS,list=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];
list.push([name,...args]);fs.writeFileSync(file,JSON.stringify(list));let value='',status=0;
if(name==='stat') value=(mode==='wrong-owner'?'1000':'0')+':'+(fs.statSync(args.at(-1)).mode&0o777).toString(8);
else if(name==='systemctl') {
  if(args[0]==='show') value=mode==='missing-service'?'not-found':'loaded';
  if((mode==='reload-fails'&&args[0]==='daemon-reload')||(mode==='enable-fails'&&args[0]==='enable')) status=1;
} else if(name==='id') value='1000';
if(status) process.stderr.write('Fictional private command detail');
if(value) process.stdout.write(value+'\\n');process.exit(status);
`, {mode: 0o755});
  for (const name of ['systemctl', 'stat', 'id', 'docker', 'mountpoint', 'findmnt']) fs.symlinkSync(boundary, path.join(bin, name));
  return {root, directory, config: path.join(root, 'etc/package-hub-backup.conf'), run(cliArgs) {
    const staged = 'set -Eeuo pipefail; umask 077; exec 2>/dev/null; source "$1"; trap abort ERR; check_host "$2"; install_service "$(dirname "$1")" "$2"';
    const result = spawnSync('bash', cliArgs ? [script, ...cliArgs] : ['-c', staged, 'fictional-install', script, root],
      {env: {...process.env, PATH: bin + path.delimiter + process.env.PATH, FICTIONAL_INSTALL_MODE: mode, FICTIONAL_INSTALL_COMMANDS: commands}, encoding: 'utf8'});
    return {...result, commands: fs.existsSync(commands) ? JSON.parse(fs.readFileSync(commands)) : []};
  }};
}

test('maintenance installer stages the exact protected source files and enables only the local socket', t => {
  const demo = fixture(t), result = demo.run();
  assert.equal(result.status, 0, result.stdout); assert.equal(result.stderr, '');
  for (const [source, target, mode] of [
    ['scripts/maintenance-host.py', 'usr/local/libexec/package-hub-maintenance-host.py', 0o755],
    ['scripts/package-hub-maintenance.service', 'etc/systemd/system/package-hub-maintenance.service', 0o644],
    ['scripts/package-hub-maintenance.socket', 'etc/systemd/system/package-hub-maintenance.socket', 0o644],
    ['compose.maintenance.yaml', 'etc/package-hub-maintenance.compose.yaml', 0o600]
  ]) {
    const installed = path.join(demo.root, target);
    assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.resolve(__dirname, '..', source)));
    assert.equal(fs.statSync(installed).mode & 0o777, mode);
  }
  assert.deepEqual(result.commands.filter(args => args[0] === 'systemctl'), [
    ['systemctl', 'show', 'package-hub-backup.service', '--property=LoadState', '--value'],
    ['systemctl', 'daemon-reload'], ['systemctl', 'enable', '--now', 'package-hub-maintenance.socket']
  ]);
  assert.equal(fs.readFileSync(demo.config, 'utf8'), 'Fictional existing installation');
});

for (const mode of ['public-config', 'symlink-config', 'missing-config', 'wrong-owner', 'missing-service']) {
  test('maintenance installer refuses ' + mode + ' before installing the adapter', t => {
    const demo = fixture(t, mode);
    if (mode === 'public-config') fs.chmodSync(demo.config, 0o644);
    if (mode === 'missing-config' || mode === 'symlink-config') fs.unlinkSync(demo.config);
    if (mode === 'symlink-config') fs.symlinkSync(path.join(demo.root, 'usr/local/libexec/package-hub-backup.sh'), demo.config);
    const result = demo.run();
    assert.notEqual(result.status, 0); assert.equal(result.stderr, '');
    assert.ok(!fs.existsSync(path.join(demo.root, 'usr/local/libexec/package-hub-maintenance-host.py')));
    assert.ok(!result.commands.some(args => args[0] === 'systemctl' && ['daemon-reload', 'enable'].includes(args[1])));
  });
}

for (const mode of ['reload-fails', 'enable-fails']) {
  test('maintenance installer ' + mode + ' reports failure without claiming a working endpoint', t => {
    const demo = fixture(t, mode), result = demo.run();
    assert.notEqual(result.status, 0); assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes('endpoint installed')); assert.ok(!result.stdout.includes('Fictional private'));
    if (mode === 'reload-fails') assert.ok(!result.commands.some(args => args[0] === 'systemctl' && args[1] === 'enable'));
  });
}

test('maintenance installer CLI refuses non-root execution and arbitrary arguments before reading host state', t => {
  for (const args of [[], ['/fictional/unexpected']]) {
    const result = fixture(t).run(args);
    assert.notEqual(result.status, 0); assert.equal(result.stderr, '');
    assert.deepEqual(result.commands, [['id', '-u']]);
  }
});
