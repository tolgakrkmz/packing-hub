const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
test('local maintenance adapter validates configuration, disks, update status, fixed backup actions and overlap', () => {
  const result = spawnSync('python3', [path.resolve(__dirname, 'maintenance-host-test.py')], {encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /Ran [1-9]\d* tests/); assert.match(result.stderr, /OK/);
});
