const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/check-restart-readiness.sh');
function audit(t, scenario = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-restart-audit-demo-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const bin = path.join(directory, 'bin'), deploy = path.join(directory, "fictional deploy 'quoted' $(demo)");
  fs.mkdirSync(bin); fs.mkdirSync(deploy);
  fs.writeFileSync(path.join(deploy, 'compose.yaml'), 'Fictional command boundary');
  fs.writeFileSync(path.join(deploy, '.env'), 'Fictional private configuration');
  fs.writeFileSync(path.join(deploy, '.env.push'), 'Fictional push configuration');
  const log = path.join(directory, 'commands'), boundary = path.join(bin, 'boundary.cjs');
  fs.writeFileSync(boundary, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),name=path.basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.DEMO_SCENARIO;
const file=process.env.DEMO_COMMANDS,list=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];
list.push([name,...args]);fs.writeFileSync(file,JSON.stringify(list));let output='',status=0;
if(name==='uname') output=mode==='wrong-os'?'Darwin':'Linux';
else if(name==='systemctl') {
  const unit=args.at(-1);
  if(args[0]==='is-enabled') output=mode===unit+'-disabled'?'disabled':'enabled';
  else if(args[0]==='is-active' && mode===unit+'-inactive') { status=3;output='fictional-secret-host-value'; }
  else if(args.includes('--property=Result')) output=mode===unit+'-failed'?'exit-code':'success';
  else if(args.includes('--property=ExecMainStatus')) output=mode===unit+'-failed'?'1':'0';
  else if(args.includes('--property=ActiveState')) output=mode==='update-running'?'activating':'inactive';
} else if(name==='docker') {
  if(args[0]==='compose') { output=mode==='missing-app'?'':'c'.repeat(64); if(mode==='compose-error') { output='fictional-secret-host-value';status=1; } }
  else if(args[0]==='inspect') {
    const format=args[2];
    if(format.includes('working_dir')) output=mode==='wrong-project'?'/fictional/other-project':process.env.DEMO_DEPLOY;
    else if(format.includes('RestartPolicy')) output=mode==='wrong-policy'?'no':'unless-stopped';
    else if(format.includes('.State.Running')) output=mode==='stopped'?'false':'true';
    else if(format.includes('.State.Health')) output=mode==='unhealthy'?'unhealthy':'healthy';
    else if(format.includes('.Mounts')) output=mode==='missing-volume'?'bind:true:':'volume:true:fictional_data';
    else if(format.includes('.NetworkSettings')) output=mode==='public-port'?'0.0.0.0:3000':'127.0.0.1:3000';
    else if(format.includes('.Config.Env')) output=(mode==='wrong-database'?'HUB_DATABASE=/tmp/fictional.sqlite':'HUB_DATABASE=/var/lib/package-hub/hub.sqlite')+'\\n'+(mode==='no-adapter'?'':'HUB_MAINTENANCE_SOCKET=/fictional/local/socket');
    if(mode==='inspect-failed') status=1;
  }
} else if(name==='curl'&&mode==='http-failed') { status=22;output='fictional-secret-host-value'; }
if(status) process.stderr.write('fictional-secret-host-value');
if(output) process.stdout.write(output+'\\n');process.exit(status);
`);
  fs.chmodSync(boundary, 0o755);
  for (const name of ['uname', 'systemctl', 'docker', 'curl']) fs.symlinkSync(boundary, path.join(bin, name));
  fs.writeFileSync(path.join(bin, 'timeout'), '#!/usr/bin/env bash\n[[ $1 == 15s ]] || exit 1\nshift\nexec "$@"\n', {mode: 0o755});
  const result = spawnSync('bash', [script, deploy], {encoding: 'utf8', env: {...process.env,
    PATH: bin + path.delimiter + process.env.PATH, DEMO_SCENARIO: scenario, DEMO_COMMANDS: log, DEMO_DEPLOY: deploy}});
  assert.equal(result.stderr, '');
  assert.ok(!result.stdout.includes('fictional-secret-host-value'));
  assert.ok(!result.stdout.includes(deploy));
  const commands = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log)) : [];
  // Every scenario must remain read-only, including failure paths.
  assert.ok(commands.every(([name, action]) => name !== 'systemctl' || ['is-enabled', 'is-active', 'show'].includes(action)));
  assert.ok(commands.every(([name, action]) => name !== 'docker' || ['compose', 'inspect'].includes(action)));
  assert.ok(commands.filter(([name, action]) => name === 'docker' && action === 'compose').every(args => args.includes('ps')));
  return {...result, commands};
}
test('read-only audit checks boot configuration, inactive oneshots and existing persistent application', t => {
  const result = audit(t);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /PASS HOST_CONFIGURATION_CHECK/);
  assert.match(result.stdout, /MANUAL reboot, external HTTPS/);
  const compose = result.commands.find(([name, action]) => name === 'docker' && action === 'compose');
  assert.equal(compose.filter(value => value === '--env-file').length, 2);
  assert.ok(result.commands.some(args => args[0] === 'curl' && args.includes('--noproxy') && args.includes('--max-time')));
});
for (const scenario of ['wrong-os', 'missing-app', 'compose-error', 'inspect-failed', 'wrong-project', 'wrong-policy', 'stopped', 'unhealthy', 'missing-volume', 'wrong-database', 'public-port', 'http-failed', 'update-running',
  ...['docker.service', 'containerd.service', 'tailscaled.service', 'package-hub-auto-update.timer', 'package-hub-backup.timer', 'package-hub-maintenance.socket'].flatMap(unit => [unit + '-disabled', unit + '-inactive']),
  'package-hub-auto-update.service-failed', 'package-hub-backup.service-failed']) {
  test('read-only audit refuses readiness for ' + scenario + ' without exposing private diagnostics', t => {
    const result = audit(t, scenario);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes('PASS HOST_CONFIGURATION_CHECK'));
  });
}
test('optional maintenance adapter is checked only when configured', t => {
  const result = audit(t, 'no-adapter');
  assert.equal(result.status, 0);
  assert.ok(!result.commands.some(args => args.includes('package-hub-maintenance.socket')));
});
