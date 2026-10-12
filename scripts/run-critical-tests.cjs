/* Run only from the reviewed demo repository. Each browser suite owns its
 * temporary database/profile; no production files or personal profiles. */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const flags = process.argv.slice(2);
if (flags.some(flag => !['--browser', '--browser-only'].includes(flag))) {
  console.error('Usage: node scripts/run-critical-tests.cjs [--browser | --browser-only]');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Critical server checks require Node.js 24+.'); process.exit(2);
}
const suites = [];
if (!flags.includes('--browser-only')) for (const directory of ['tests', 'tests/server']) {
  const files = fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.test.cjs')).sort().map(file => directory + '/' + file);
  suites.push([directory, ['--test', ...files]]);
}
if (flags.includes('--browser') || flags.includes('--browser-only')) {
  // The default flows already cover permission matrices, account deletion,
  // assignment and photo options. Focused suites below add distinct scenarios.
  for (const [script, modes] of [
    ['run-browser-tests.cjs', ['', 'statistics', 'transfer', 'pair-cancellation', 'lists', 'i18n', 'security', 'security-client', 'responsive']],
    ['run-server-browser-tests.cjs', ['', 'report-operations', 'statistics', 'transfer', 'packing', 'routes', 'notifications', 'notification-targets', 'activity', 'pair-cancellation', 'status', 'branding', 'lists', 'static', 'admin-panel', 'task-history', 'task-performance', 'security', 'security-client', 'reconnect']]
  ]) {
    // The report-history feature has its own focused flow. Include it once
    // that reviewed feature is integrated, without requiring its branch here.
    if (script === 'run-server-browser-tests.cjs' && fs.existsSync(path.join(root, 'tests/browser/report-history.cjs'))) modes.push('report-history');
    for (const mode of modes) suites.push([script + ':' + (mode || 'default'), ['scripts/' + script, '--headless', ...(mode ? ['--' + mode + '-only'] : [])]]);
  }
}
let passed = 0;
const failed = [];
for (const [name, args] of suites) {
  console.log('SUITE ' + name);
  const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit', env: {...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '')}});
  if (result.status === 0) { passed++; console.log('SUITE PASS ' + name); }
  else { failed.push(name); console.error('SUITE FAIL ' + name + (result.signal ? ' signal=' + result.signal : '')); }
}
console.log('Critical suite runs: ' + passed + ' passed; ' + failed.length + ' failed.');
if (failed.length) { console.error('Failed suites: ' + failed.join(', ')); process.exitCode = 1; }
