const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// The repository uses literal paths, * and trailing /** only. Docker evaluates
// each rule against the path and its parents; the last matching rule wins.
function included(file) {
  let result = true;
  const parts = file.split('/');
  const parents = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  for (const line of read('.dockerignore').split('\n').map(value => value.trim()).filter(value => value && !value.startsWith('#'))) {
    const allow = line.startsWith('!');
    const pattern = (allow ? line.slice(1) : line).replace(/^\/+|\/+$/g, '');
    assert.match(pattern, /^[a-zA-Z0-9._/*-]+$/, 'Review new Docker ignore pattern syntax');
    assert.ok(!pattern.includes('**') || pattern.endsWith('/**'), 'Review new recursive Docker pattern syntax');
    const source = pattern.split(/(\*\*|\*)/).map(token => token === '**' ? '.*' : token === '*' ? '[^/]*' : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    if (parents.some(parent => new RegExp('^' + source + '$').test(parent))) result = allow;
  }
  return result;
}

test('every Docker COPY input remains available after filtering the build context', () => {
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root}).toString('utf8').split('\0').filter(Boolean);
  const inputs = read('Dockerfile').split('\n').filter(line => /^COPY /.test(line)).flatMap(line => line.split(/\s+/).slice(1).filter(token => !token.startsWith('--')).slice(0, -1));
  assert.ok(inputs.length > 0);
  for (const input of inputs) {
    const expression = new RegExp('^' + input.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    const required = files.filter(file => expression.test(file) || file.startsWith(input.replace(/\/$/, '') + '/'));
    assert.ok(required.length > 0, 'COPY source must exist: ' + input);
    for (const file of required) assert.ok(included(file), 'COPY input is excluded from the Docker context: ' + file);
  }
});

test('build context keeps local settings, state, nested private folders and test files excluded', () => {
  const excluded = ['.env', '.env.push', '.git/config', 'data/demo.json', 'tests/demo.test.cjs', 'server/local.sqlite', 'server/.env', 'server/private/demo.cjs', 'scripts/.env', 'scripts/private/demo.cjs', 'scripts/auto-update.sh', 'js/private/demo.js', 'js/.env', 'css/private/demo.css', 'assets/private/demo.svg'];
  for (const file of excluded) assert.equal(included(file), false, 'Local-only input must stay outside the build context: ' + file);
});
