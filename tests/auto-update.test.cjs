const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const updater = path.resolve(__dirname, '../scripts/auto-update.sh');
const candidate = 'b'.repeat(40);

// Execute the real shell workflow with isolated command boundaries and fictional IDs.
function environment(t, scenario = 'success') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-update-demo-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bin = path.join(dir, 'bin'), source = path.join(dir, 'source'), state = path.join(dir, 'state');
  for (const name of [bin, source, state]) fs.mkdirSync(name);
  const config = path.join(dir, 'config');
  fs.writeFileSync(config, `SOURCE_DIR='${source}'\nDEPLOY_DIR='${dir}/existing-project'\nBUILD_OVERRIDE='${dir}/build-override'\nCOMPOSE_PROJECT=demo-hub\nSTATE_DIR='${state}'\n`);
  const maintenance = path.join(dir, 'maintenance-override');
  if (scenario === 'maintenance-enabled') {
    fs.writeFileSync(maintenance, 'Fictional Compose boundary');
    fs.appendFileSync(config, `MAINTENANCE_OVERRIDE='${maintenance}'\n`);
  }
  const mock = path.join(dir, 'boundary.cjs');
  fs.writeFileSync(mock, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2), mode = process.env.DEMO_SCENARIO;
const file = process.env.DEMO_BOUNDARY_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {commands: [], starts: 0, restored: false};
state.commands.push([name, ...args]);
let out = '', status = 0;
if (name === 'git') {
  const a = args.slice(4), command = a[0];
  if (command === 'branch') out = mode === 'wrong-branch' ? 'feature' : 'main';
  if (command === 'status') out = mode === 'dirty' ? ' M js/demo.js' : '';
  if (command === 'remote') out = mode === 'wrong-origin' ? 'https://example.invalid/demo.git' : 'https://github.com/tolgakrkmz/packing-hub.git';
  if (command === 'fetch' && mode === 'offline') status = 1;
  if (command === 'rev-parse') out = (a[1] === 'HEAD' ? 'a' : 'b').repeat(40);
  if (command === 'merge-base' && mode === 'diverged') status = 1;
  if (command === 'diff' && mode === 'config-change') status = 1;
} else if (name === 'docker') {
  if (args[0] === 'compose') {
    const a = args.slice(args.indexOf('-p') + 2);
    if (a[0] === 'ps') out = 'c'.repeat(64);
    if (a[0] === 'config') out = 'demo-hub-package-hub:latest';
    if (a[0] === 'build' && mode === 'build-fails') status = 1;
    if (a[0] === 'up') {
      state.starts++;
      if (['unhealthy', 'rollback-fails'].includes(mode) && state.starts === 1) status = 1;
      if (mode === 'rollback-fails' && state.starts === 2) status = 1;
    }
  } else if (args[0] === 'inspect') {
    const format = args[2];
    if (format.includes('.State.Running')) out = 'true';
    else if (format.includes('.Mounts')) out = mode === 'volume-change' && state.starts && !state.restored ? 'demo-other-volume' : 'demo-existing-data';
    else if (format.includes('.Config.Image')) out = 'demo-hub-package-hub';
    else if (format.includes('.Image')) out = 'sha256:' + (state.starts && !state.restored ? 'b' : 'a').repeat(64);
  } else if (args[0] === 'image' && args[1] === 'inspect') out = 'sha256:' + 'b'.repeat(64);
  else if (args[0] === 'image' && args[1] === 'tag') state.restored = true;
  else if (args[0] === 'exec' && args.includes('backup') && mode === 'backup-fails') status = 1;
  else if (args[0] === 'run' && mode === 'smoke-fails') status = 1;
} else if (name === 'curl' && mode === 'health-fails') status = 1;
else if (name === 'flock' && mode === 'locked') status = 1;
else if (name === 'date') out = args.includes('+%Y-%m-%dT%H:%M:%S.000Z') ? '2026-10-06T00:00:00.000Z' : '20261006T000000Z';
fs.writeFileSync(file, JSON.stringify(state));
if (out) process.stdout.write(out + '\\n');
process.exit(status);
`);
  fs.chmodSync(mock, 0o755);
  for (const command of ['git', 'docker', 'curl', 'flock', 'date']) fs.symlinkSync(mock, path.join(bin, command));
  const boundary = path.join(dir, 'boundary-state');
  return {
    state, maintenance,
    run() {
      const result = spawnSync('bash', [updater], {encoding: 'utf8', env: {...process.env, PATH: bin + path.delimiter + process.env.PATH, HUB_UPDATE_CONFIG: config, DEMO_SCENARIO: scenario, DEMO_BOUNDARY_STATE: boundary}});
      return {...result, commands: JSON.parse(fs.readFileSync(boundary)).commands};
    }
  };
}
const up = commands => commands.filter(a => a[0] === 'docker' && a[1] === 'compose' && a.includes('up'));

test('deploy builds and checks the candidate, backs up locally, preserves the volume and records success', t => {
  const demo = environment(t), result = demo.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(demo.state, 'last-good'), 'utf8').trim(), candidate);
  assert.ok(fs.readFileSync(path.join(demo.state, 'last-attempt'), 'utf8').endsWith('\nok\n'));
  assert.match(fs.readFileSync(path.join(demo.state, 'last-attempt'), 'utf8'), /^2026-10-06T00:00:00\.000Z\nok\n$/);
  const commands = result.commands;
  const smoke = commands.findIndex(a => a[0] === 'docker' && a[1] === 'run');
  const backup = commands.findIndex(a => a.includes('backup'));
  const start = commands.findIndex(a => up([a]).length);
  assert.ok(smoke >= 0 && smoke < backup && backup < start);
  assert.ok(commands[backup].at(-1).startsWith('/var/lib/package-hub/auto-backups/'));
  assert.equal(up(commands).length, 1);
  assert.ok(up(commands)[0].includes('--wait'));
  assert.ok(up(commands)[0].some(a => a.endsWith('/existing-project/compose.yaml')));
  assert.ok(up(commands)[0].some(a => a.endsWith('/build-override')));
  assert.ok(!commands.some(a => a.includes('push') || a.includes('down') || a.includes('--renew-anon-volumes')));
});

test('unchanged successful main and an overlapping run never rebuild or restart the site', t => {
  const demo = environment(t);
  fs.writeFileSync(path.join(demo.state, 'last-good'), candidate + '\n');
  const unchanged = demo.run();
  assert.equal(unchanged.status, 0);
  assert.ok(!unchanged.commands.some(a => a[0] === 'docker'));
  const locked = environment(t, 'locked').run();
  assert.equal(locked.status, 0);
  assert.deepEqual(locked.commands.map(a => a[0]), ['flock']);
});

for (const scenario of ['wrong-branch', 'dirty', 'wrong-origin', 'offline', 'diverged', 'config-change', 'build-fails', 'smoke-fails', 'backup-fails']) {
  test(scenario + ' blocks deployment before replacing the running container', t => {
    const demo = environment(t, scenario), result = demo.run();
    assert.notEqual(result.status, 0);
    assert.equal(up(result.commands).length, 0);
    assert.ok(fs.readFileSync(path.join(demo.state, 'last-attempt'), 'utf8').endsWith('\nfailed\n'));
  });
}
test('automatic deployment preserves the explicitly configured local maintenance mount', t => {
  const demo = environment(t, 'maintenance-enabled'), result = demo.run();
  assert.equal(result.status, 0, result.stderr);
  for (const args of result.commands.filter(args => args[0] === 'docker' && args[1] === 'compose')) assert.ok(args.includes(demo.maintenance));
});

for (const scenario of ['unhealthy', 'health-fails', 'volume-change', 'rollback-fails']) {
  test(scenario + ' restores the previous image and blocks repeat deployment of that revision', t => {
    const demo = environment(t, scenario), result = demo.run();
    assert.notEqual(result.status, 0);
    assert.equal(up(result.commands).length, 2);
    assert.ok(result.commands.some(a => a[0] === 'docker' && a[1] === 'image' && a[2] === 'tag'));
    assert.equal(fs.existsSync(path.join(demo.state, 'last-good')), false);
    assert.equal(fs.readFileSync(path.join(demo.state, 'last-failed'), 'utf8').trim(), candidate);
    const retry = demo.run();
    assert.notEqual(retry.status, 0);
    assert.equal(up(retry.commands).length, 2);
  });
}
