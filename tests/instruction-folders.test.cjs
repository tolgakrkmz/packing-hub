const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/instruction-folders.js'), 'utf8'), sandbox);
const folders = vm.runInContext('HubInstructionFolders', sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
function file(name, text = 'Fictional document') {
  return {kind: 'file', name, getFile: async () => ({text: async () => text})};
}
function directory(name, children = []) {
  const entries = new Map(children.map(child => [child.name, child]));
  return {
    kind: 'directory', name,
    async *entries() { yield* entries; },
    async getDirectoryHandle(name, {create = false} = {}) {
      if (create && !entries.has(name)) entries.set(name, directory(name));
      if (entries.get(name)?.kind !== 'directory') throw new Error('Missing fictional directory');
      return entries.get(name);
    },
    async getFileHandle(name, {create = false} = {}) {
      if (create && !entries.has(name)) entries.set(name, file(name, ''));
      if (entries.get(name)?.kind !== 'file') throw new Error('Missing fictional attachment');
      return entries.get(name);
    }
  };
}
const scan = (handle, options = {}) => folders.scan(handle, {copyNeeded: true, ...options});

test('customer → numeric profile → PDF/image produces one profile per folder', async () => {
  const root = directory('Demo instructions', [directory('Demo customer A', [
    directory('001234', [file('demo.pdf'), file('demo.png')]),
    directory('AB-5678', [file('instruction.txt', 'Fictional packing steps')])
  ])]);
  const {candidates} = await scan(root);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].client, 'Demo customer A');
  assert.equal(candidates[0].number, '001234');
  assert.equal(candidates[0].originalPath, 'Demo customer A/001234');
  assert.deepEqual(plain(candidates[0].files), ['demo.pdf', 'demo.png']);
  assert.equal(candidates[1].number, 'AB-5678');
  assert.equal(candidates[1].instructionText, 'Fictional packing steps');
});

test('attachments below extra instruction/version folders stay with the profile', async () => {
  const root = directory('Demo instructions', [directory('Demo customer', [directory('1234', [
    file('direct-demo.pdf'), directory('Instructions', [directory('Revision 1', [file('nested-demo.png'), file('instruction.txt')])])
  ])])]);
  const {candidates} = await scan(root);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].number, '1234');
  assert.deepEqual(plain(candidates[0].files), ['direct-demo.pdf', 'Instructions/Revision 1/instruction.txt', 'Instructions/Revision 1/nested-demo.png']);
});

test('a client containing direct documents and profile subfolders retains both', async () => {
  const {candidates} = await scan(directory('Demo instructions', [directory('Demo customer', [
    file('general-demo.pdf'), directory('1234', [file('profile-demo.pdf')])
  ])]));
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].client, 'Demo customer');
  assert.equal(candidates[0].number, '');
  assert.equal(candidates[1].number, '1234');
});

test('nonnumeric folders are discovered at arbitrary depths and remain editable', async () => {
  const {candidates} = await scan(directory('Demo instructions', [directory('Demo customer', [
    directory('Demo group', [directory('Demo profile', [directory('Demo instruction', [file('demo.pdf')])])])
  ])]));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].client, 'Demo customer');
  assert.equal(candidates[0].number, '');
  assert.equal(candidates[0].originalPath, 'Demo customer/Demo group/Demo profile/Demo instruction');
});

test('a selected customer folder retains its name and path in automatic or explicit mode', async () => {
  const root = directory('Demo customer', [directory('1234', [file('demo.pdf')])]);
  for (const layout of ['auto', 'client']) {
    const {candidates} = await scan(root, {layout});
    assert.equal(candidates[0].client, 'Demo customer');
    assert.equal(candidates[0].originalPath, 'Demo customer/1234');
  }
});

test('a selected profile folder imports its own files and all nested attachments', async () => {
  const root = directory('1234', [file('demo.pdf'), directory('Steps', [file('demo.png')])]);
  for (const layout of ['auto', 'profile']) {
    const {candidates} = await scan(root, {layout});
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].number, '1234');
    assert.equal(candidates[0].originalPath, '1234');
    assert.deepEqual(plain(candidates[0].files), ['demo.pdf', 'Steps/demo.png']);
    candidates[0].client = 'Demo customer A';
    assert.equal(folders.destinationPath(candidates[0]), 'Demo customer A/1234');
    candidates[0].client = 'Demo customer B';
    assert.equal(folders.destinationPath(candidates[0]), 'Demo customer B/1234');
  }
});

test('explicit customer layout resolves ambiguous client identifiers', async () => {
  const {candidates} = await scan(directory('Demo instructions', [directory('C1', [directory('1234', [file('demo.pdf')])])]), {layout: 'clients'});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].client, 'C1');
  assert.equal(candidates[0].number, '1234');
});

test('flat profile folders preserve legacy name/number conventions', async () => {
  const {candidates} = await scan(directory('Demo instructions', [directory('Demo box - 900003', [file('demo.pdf')])]));
  assert.equal(candidates[0].name, 'Demo box');
  assert.equal(candidates[0].number, '900003');
  assert.equal(folders.parseName('Профил 001234').number, '001234');
  assert.equal(folders.parseName('Profile AB-1234').number, 'AB-1234');
});

test('a selected profiles collection does not become an invented customer', async () => {
  const {candidates} = await scan(directory('profiles', [directory('1234', [file('demo.pdf')])]));
  assert.equal(candidates[0].client, '');
  assert.equal(candidates[0].originalPath, '1234');
});

test('root-level files are included even without a profile subfolder', async () => {
  const {candidates} = await scan(directory('Demo instructions', [file('demo.pdf')]));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].originalPath, 'Demo instructions');
  const local = await scan(directory('profiles', [file('unassigned-demo.pdf')]), {copyNeeded: false});
  assert.equal(local.candidates.length, 0);
});

test('empty/system folders are ignored without treating system files as instructions', async () => {
  const {candidates, skippedEmpty} = await scan(directory('Demo instructions', [
    directory('Demo empty'), directory('.git', [file('config')]),
    directory('Demo customer', [file('.DS_Store'), file('Thumbs.db'), file('desktop.ini'), file('demo.pdf')])
  ]));
  assert.equal(candidates.length, 1);
  assert.deepEqual(plain(candidates[0].files), ['demo.pdf']);
  assert.equal(skippedEmpty, 1);
});

test('existing folders are skipped by path while equal numbers for other clients are kept', async () => {
  const index = {'1234': {number: '1234', folderName: 'Demo customer A/1234'}};
  const root = directory('profiles', ['A', 'B'].map(letter => directory('Demo customer ' + letter, [directory('1234', [file('demo.pdf')])])));
  const {candidates} = await scan(root, {copyNeeded: false, skipExisting: true, index});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].client, 'Demo customer B');
  assert.equal(candidates[0].number, '1234');
  assert.equal(folders.allocateKey(index, '1234'), '1234~2');
  assert.equal(folders.allocateKey({...index, '1234~2': {}}, '1234'), '1234~3');
});

test('nested file handles preserve relative paths when reading and copying', async () => {
  const source = directory('1234', [directory('Steps', [file('demo.pdf')])]);
  const destination = directory('1234');
  assert.equal((await folders.fileHandle(source, 'Steps/demo.pdf')).name, 'demo.pdf');
  assert.equal((await folders.fileHandle(destination, 'Steps/demo.pdf', true)).name, 'demo.pdf');
  for (const name of ['../demo.pdf', '/demo.pdf', 'Steps//demo.pdf', 'Steps\\demo.pdf']) {
    await assert.rejects(folders.fileHandle(source, name), /Invalid attachment path/);
  }
});

test('unreadable instructions stop discovery instead of silently skipping their contents', async () => {
  const unreadable = {kind: 'file', name: 'instruction.txt', getFile: async () => {throw new Error('Synthetic read failure');}};
  await assert.rejects(scan(directory('1234', [unreadable])), /Synthetic read failure/);
});
