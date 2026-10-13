const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const scanner = require('../scripts/check-publication.cjs');
const git = (cwd, args, input) => execFileSync('git', args, {cwd, input, stdio: ['pipe', 'pipe', 'pipe']}).toString().trim();
function repository(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-batch-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Demo Tester']);
  git(dir, ['config', 'user.email', 'demo@example.invalid']);
  fs.mkdirSync(path.join(dir, 'js'));
  return dir;
}
function commit(dir) {
  git(dir, ['add', '.']);
  git(dir, ['commit', '--allow-empty', '-m', 'Fictional scanner scenario']);
  return git(dir, ['rev-parse', 'HEAD']);
}
function scan(refs, tokens, dir) {
  return scanner.checkSnapshots ? scanner.checkSnapshots(refs, tokens, dir) : refs.map(ref => scanner.checkSnapshot(ref, tokens, dir));
}
function injectedListing(dir, ref, listing) {
  const program = `
    const cp = require('node:child_process'), original = cp.execFileSync;
    cp.execFileSync = (command, args, options) => command === 'git' && ['ls-tree', 'ls-files'].includes(args[0]) ? Buffer.from(${JSON.stringify(listing)}) : original(command, args, options);
    require(${JSON.stringify(path.resolve(__dirname, '../scripts/check-publication.cjs'))}).checkSnapshot(process.argv[2], [], process.argv[1]);
  `;
  return () => execFileSync(process.execPath, ['-e', program, dir, ref], {stdio: ['pipe', 'pipe', 'pipe']});
}
test('snapshot enumeration refuses truncated or malformed listings before reading blobs', t => {
  const dir = repository(t);
  fs.writeFileSync(path.join(dir, 'js/example.js'), 'Safe fictional source');
  const first = commit(dir);
  const blob = git(dir, ['rev-parse', first + ':js/example.js']);
  for (const ref of [first, '--staged']) {
    const fields = ref === '--staged' ? '100644 ' + blob + ' 0' : '100644 blob ' + blob;
    assert.doesNotThrow(injectedListing(dir, ref, fields + '\tjs/example.js\0'));
    for (const output of [fields + '\tjs/example.js', fields + ' extra\tjs/example.js\0', fields + '\tjs/example.js\0partial', fields + '\tjs/example.js\0\0']) {
      assert.throws(injectedListing(dir, ref, output));
    }
  }
  assert.throws(injectedListing(dir, first, '100644 tree ' + blob + '\tjs/example.js\0'));
});
test('a full outgoing history uses bounded batches instead of a process per repeated blob', t => {
  const dir = repository(t);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, 'js', 'example-' + i + '.js'), 'Safe fictional source ' + i);
  for (let i = 0; i < 8; i++) commit(dir);
  const program = `
    const cp = require('node:child_process');
    const original = cp.execFileSync;
    let reads = 0;
    cp.execFileSync = (command, args, options) => {
      if (command === 'git' && args[0] === 'cat-file') reads++;
      return original(command, args, options);
    };
    const scanner = require(${JSON.stringify(path.resolve(__dirname, '../scripts/check-publication.cjs'))});
    const refs = original('git', ['rev-list', 'HEAD'], {cwd: process.argv[1]}).toString().trim().split('\\n');
    const counts = scanner.checkSnapshots ? scanner.checkSnapshots(refs, [], process.argv[1]) : refs.map(ref => scanner.checkSnapshot(ref, [], process.argv[1]));
    console.log(JSON.stringify({counts, reads}));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['-e', program, dir]).toString());
  assert.deepEqual(result.counts, Array(8).fill(60));
  assert.ok(result.reads <= 4, 'Unchanged outgoing blobs must not start hundreds of Git processes');
});
test('cached content still checks a new forbidden path and a new symlink mode', t => {
  for (const variant of ['path', 'mode']) {
    const dir = repository(t);
    fs.writeFileSync(path.join(dir, 'js/example.js'), 'Safe fictional source');
    const first = commit(dir);
    const blob = git(dir, ['rev-parse', first + ':js/example.js']);
    git(dir, ['update-index', '--add', '--cacheinfo', variant === 'mode' ? '120000' : '100644', blob, variant === 'mode' ? 'js/example.js' : 'private/example.js']);
    const tree = git(dir, ['write-tree']);
    assert.throws(() => scan([first, tree], [], dir), /Unapproved/);
  }
});
test('cache decisions do not cross invocations, repositories or private reference sets', t => {
  const dir = repository(t);
  fs.writeFileSync(path.join(dir, 'js/example.js'), 'Fictional restricted marker');
  const first = commit(dir);
  assert.deepEqual(scan([first, first], [], dir), [1, 1]);
  assert.throws(() => scan([first], ['fictional restricted marker'], dir), /Private source/);
  const other = repository(t);
  assert.throws(() => scan([first], [], other));
});
test('an approved blob at another allowed path still checks filename tokens and fixture pins', t => {
  const dir = repository(t);
  fs.writeFileSync(path.join(dir, 'js/example.js'), 'Safe fictional source');
  const first = commit(dir);
  const blob = git(dir, ['rev-parse', first + ':js/example.js']);
  git(dir, ['update-index', '--add', '--cacheinfo', '100644', blob, 'js/restricted-marker.js']);
  assert.throws(() => scan([first, '--staged'], ['restricted-marker'], dir), /Private source/);
  git(dir, ['update-index', '--force-remove', 'js/restricted-marker.js']);
  git(dir, ['update-index', '--add', '--cacheinfo', '100644', blob, 'js/employees-seed.js']);
  assert.throws(() => scan([first, '--staged'], [], dir), /fixture has changed/);
});
test('batches cover more than one object window and large allowed blobs without dropping entries', t => {
  const dir = repository(t);
  for (let i = 0; i < 520; i++) fs.writeFileSync(path.join(dir, 'js', 'example-' + i + '.js'), 'Safe fictional source ' + i);
  fs.writeFileSync(path.join(dir, 'js/large-a.js'), Buffer.alloc(9 * 1024 * 1024, 32));
  fs.writeFileSync(path.join(dir, 'js/large-b.js'), Buffer.alloc(5 * 1024 * 1024, 32));
  fs.writeFileSync(path.join(dir, 'js/large-c.js'), Buffer.alloc(5 * 1024 * 1024, 10));
  git(dir, ['add', '.']);
  assert.deepEqual(scan(['--staged'], [], dir), [523]);
  fs.writeFileSync(path.join(dir, 'js/too-large.js'), Buffer.alloc(32 * 1024 * 1024 + 1, 32));
  git(dir, ['add', '.']);
  assert.throws(() => scan(['--staged'], [], dir));
});
test('batch reads use the staged index and reject conflicts and missing objects', t => {
  const dir = repository(t);
  const file = path.join(dir, 'js/example.js');
  fs.writeFileSync(file, 'Fictional restricted marker');
  git(dir, ['add', '.']);
  fs.writeFileSync(file, 'Safe working file');
  assert.throws(() => scan(['--staged'], ['fictional restricted marker'], dir), /Private source/);
  git(dir, ['add', '.']);
  assert.deepEqual(scan(['--staged'], ['fictional restricted marker'], dir), [1]);
  const blob = git(dir, ['rev-parse', ':js/example.js']);
  git(dir, ['update-index', '--index-info'], '0 ' + '0'.repeat(40) + '\tjs/example.js\n100644 ' + blob + ' 1\tjs/example.js\n100644 ' + blob + ' 2\tjs/example.js\n');
  assert.throws(() => scan(['--staged'], [], dir), /conflicts/);
  git(dir, ['update-index', '--force-remove', 'js/example.js']);
  git(dir, ['update-index', '--add', '--cacheinfo', '100644', '1'.repeat(40), 'js/missing.js']);
  assert.throws(() => scan(['--staged'], [], dir));
});
test('new branches, existing branches, absent remote objects and multiple refs retain unsafe history', t => {
  const dir = repository(t);
  const file = path.join(dir, 'js/example.js');
  fs.writeFileSync(file, 'Safe fictional source');
  const baseline = commit(dir);
  const credential = ['ghp', '_', 'z'.repeat(30)].join('');
  fs.writeFileSync(file, credential);
  commit(dir);
  fs.writeFileSync(file, 'Safe fictional source');
  const tip = commit(dir);
  for (const remote of ['0'.repeat(40), baseline, '1'.repeat(40)]) {
    const refs = scanner.commitsForPush('refs/heads/demo ' + tip + ' refs/heads/demo ' + remote + '\n', dir);
    assert.equal(refs.length, remote === baseline ? 2 : 3);
    assert.throws(() => scan(refs, [], dir), error => /Credential/.test(error.message) && !error.message.includes(credential));
  }
  const refs = scanner.commitsForPush('refs/heads/demo ' + tip + ' refs/heads/demo ' + baseline + '\nrefs/heads/other ' + tip + ' refs/heads/other ' + '0'.repeat(40) + '\n', dir);
  assert.equal(refs.length, 3);
  assert.deepEqual(scanner.commitsForPush('refs/heads/demo ' + '0'.repeat(40) + ' refs/heads/demo ' + tip + '\n', dir), []);
});
test('batch framing uses byte sizes and rejects incomplete, reordered or extra responses without echoing them', () => {
  const hash = 'a'.repeat(40), other = 'b'.repeat(40);
  const content = Buffer.from('Fictional π\n' + hash + ' blob 0\n');
  const objects = [{hash, size: content.length}];
  const header = Buffer.from(hash + ' blob ' + content.length + '\n');
  const valid = Buffer.concat([header, content, Buffer.from('\n')]);
  assert.deepEqual(scanner.parseBatchResponse(valid, objects), [content]);
  const marker = 'Fictional restricted marker';
  for (const output of [valid.subarray(0, -1), valid.subarray(0, header.length + 2), Buffer.from(hash + ' missing\n'), Buffer.concat([Buffer.from(other + ' blob ' + content.length + '\n'), content, Buffer.from('\n')]), Buffer.concat([valid, Buffer.from(marker)]), Buffer.from(hash + ' tree 0\n\n'), Buffer.from(hash + ' blob 999999999999999999999\n')]) {
    assert.throws(() => scanner.parseBatchResponse(output, objects), error => !error.message.includes(marker));
  }
});
test('the pre-push entry point blocks an unsafe older commit even on a new branch', t => {
  const dir = repository(t);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.resolve(__dirname, '../scripts/check-publication.cjs'), path.join(dir, 'scripts/check-publication.cjs'));
  const file = path.join(dir, 'js/example.js');
  fs.writeFileSync(file, 'Safe fictional source');
  commit(dir);
  fs.writeFileSync(file, ['ghp', '_', 'z'.repeat(30)].join(''));
  commit(dir);
  fs.writeFileSync(file, 'Safe fictional source');
  const tip = commit(dir);
  assert.throws(() => execFileSync(process.execPath, ['scripts/check-publication.cjs', '--push'], {
    cwd: dir, env: {...process.env, PACKAGE_HUB_PRIVATE_SOURCE: dir},
    input: 'refs/heads/demo ' + tip + ' refs/heads/demo ' + '0'.repeat(40) + '\n', stdio: ['pipe', 'pipe', 'pipe']
  }), error => error.status === 1 && /PUBLICATION BLOCKED: Credential/.test(error.stderr.toString()) && !error.stderr.includes('z'.repeat(30)));
});
