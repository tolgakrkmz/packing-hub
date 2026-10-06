/* Private staging and atomic migration of reviewed legacy module formats. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {defaults, problem, safePath, validateData, personnelModel} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const limits = {fileBytes: 20 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, files: 5000, jsonBytes: 20 * 1024 * 1024};
const lifetime = 4 * 60 * 60 * 1000;
const same = (a, b) => isDeepStrictEqual(a, b);
const clone = value => JSON.parse(JSON.stringify(value));
function mergeRows(current, incoming, key, summary, normalize = value => value) {
  const rows = current.map(normalize), byId = new Map(rows.map(row => [row[key], row]));
  for (const row of incoming.map(normalize)) {
    if (!byId.has(row[key])) { rows.push(row); byId.set(row[key], row); summary.added++; }
    else if (same(byId.get(row[key]), row)) summary.duplicates++;
    else summary.conflicts++;
  }
  return rows;
}
function mergeHistory(current, incoming) {
  const left = current.slice();
  const available = current.slice();
  for (const row of incoming) {
    const at = available.findIndex(prior => same(row, prior));
    if (at >= 0) available.splice(at, 1); else left.push(row);
  }
  return left;
}
function createImports(store, filename) {
  const temporary = filename === ':memory:';
  const directory = temporary ? fs.mkdtempSync(path.join(os.tmpdir(), 'hub-demo-import-')) : path.join(path.dirname(filename), 'import-staging');
  fs.mkdirSync(directory, {recursive: true, mode: 0o700}); fs.chmodSync(directory, 0o700);
  function read(id, user) {
    if (!can(user, 'canImportData')) throw problem(403, 'FORBIDDEN');
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw problem(404, 'IMPORT_EXPIRED');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, id, 'manifest.json'), 'utf8')); }
    catch { throw problem(404, 'IMPORT_EXPIRED'); }
    if (manifest.owner !== user.id) throw problem(403, 'FORBIDDEN');
    if (manifest.created + lifetime < Date.now()) { discard(id, user); throw problem(404, 'IMPORT_EXPIRED'); }
    return manifest;
  }
  function discard(id, user) {
    if (!can(user, 'canImportData')) throw problem(403, 'FORBIDDEN');
    // Only managed UUID directories may be removed; no request path is used directly.
    if (!/^[0-9a-f-]{36}$/.test(id)) throw problem(404, 'IMPORT_EXPIRED');
    fs.rmSync(path.join(directory, id), {recursive: true, force: true});
  }
  function create(input, user) {
    if (!can(user, 'canImportData')) throw problem(403, 'FORBIDDEN');
    if (!input || typeof input.documents !== 'object' || !input.documents || Array.isArray(input.documents) || !Object.keys(input.documents).length || !Array.isArray(input.files) || typeof input.includeSettings !== 'boolean') throw problem(400, 'INVALID_DATA');
    for (const [kind, data] of Object.entries(input.documents)) validateData(kind, data);
    const profiles = input.documents['package-instructions'];
    const names = new Set(); let bytes = 0;
    if (input.files.length > limits.files) throw problem(413, 'TOO_LARGE');
    const files = input.files.map(file => {
      safePath(file?.path);
      if (!profiles || !file.path.startsWith('data/profiles/') || !Object.values(profiles).some(profile => file.path.startsWith('data/profiles/' + profile.folderName + '/')) || names.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.fileBytes || typeof file.mime !== 'string' || file.mime.length > 100 || !/^[a-z0-9-]+\/[a-z0-9.+-]+$/i.test(file.mime)) throw problem(400, 'INVALID_DATA');
      names.add(file.path); bytes += file.size;
      return {path: file.path, size: file.size, mime: file.mime};
    });
    if (bytes > limits.totalBytes) throw problem(413, 'TOO_LARGE');
    const id = input.id || randomUUID();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw problem(400, 'INVALID_DATA');
    const folder = path.join(directory, id);
    if (fs.existsSync(folder)) {
      const prior = read(id, user);
      if (!same(prior.documents, input.documents) || !same(prior.files, files) || prior.includeSettings !== input.includeSettings) throw problem(409, 'CONFLICT');
      return {id, files: files.length};
    }
    let active = 0;
    for (const id of fs.readdirSync(directory)) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      try {
        const old = JSON.parse(fs.readFileSync(path.join(directory, id, 'manifest.json'), 'utf8'));
        if (old.created + lifetime < Date.now()) fs.rmSync(path.join(directory, id), {recursive: true, force: true});
        else if (old.owner === user.id) active++;
      } catch { /* Do not inspect or expose incomplete private staging contents. */ }
    }
    if (active >= 4) throw problem(429, 'IMPORT_LIMIT');
    fs.mkdirSync(folder, {mode: 0o700});
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({owner: user.id, created: Date.now(), documents: input.documents, files, includeSettings: input.includeSettings}), {mode: 0o600});
    return {id, files: files.length};
  }
  function upload(id, index, content, user) {
    const manifest = read(id, user);
    if (!Number.isSafeInteger(index) || !manifest.files[index] || manifest.files[index].size !== content.length || content.length > limits.fileBytes) throw problem(400, 'INVALID_DATA');
    const folder = path.join(directory, id), destination = path.join(folder, String(index));
    fs.writeFileSync(destination + '.tmp', content, {mode: 0o600}); fs.renameSync(destination + '.tmp', destination);
    fs.rmSync(path.join(folder, 'preview.json'), {force: true});
    return {ok: true};
  }
  function plan(id, manifest) {
    const states = Object.fromEntries(Object.keys(defaults).map(kind => [kind, store.get(kind)]));
    const snapshot = {documents: Object.fromEntries(Object.entries(states).map(([kind, state]) => [kind, state.revision])), files: {}};
    const updates = {}, summaries = {};
    for (const [kind, input] of Object.entries(manifest.documents)) {
      const current = states[kind].data, summary = {total: 0, added: 0, duplicates: 0, conflicts: 0, settingsChanges: 0, historyAdded: 0};
      let data = clone(current);
      if (kind === 'package-instructions') {
        summary.total = Object.keys(input).length;
        for (const [key, row] of Object.entries(input)) {
          safePath('data/profiles/' + row.folderName);
          if (!Object.hasOwn(data, key)) { data[key] = row; summary.added++; }
          else if (same(data[key], row)) summary.duplicates++;
          else summary.conflicts++;
        }
      } else {
        const field = kind === 'personnel' ? 'employees' : 'entries'; summary.total = input[field].length;
        const normalize = kind === 'personnel' ? row => ({...row, ...clone(personnelModel.normalizeEmployee(row))}) : kind === 'production-log' ? row => ({...row, breakdown: row.breakdown ?? null}) : row => row;
        data[field] = mergeRows(current[field], input[field], 'id', summary, normalize);
        if (kind === 'personnel') {
          data.schemaVersion = 3;
          data.moveLog = mergeHistory(current.moveLog || [], input.moveLog || []);
          summary.historyAdded = data.moveLog.length - (current.moveLog || []).length;
          if (manifest.includeSettings && input.settings) {
            const settings = clone(personnelModel.normalizeSettings({...current.settings, ...input.settings}));
            if (!same(current.settings, settings)) summary.settingsChanges++;
            data.settings = settings;
          }
        }
        if (kind === 'production-log' && manifest.includeSettings && input.goalTons !== undefined) {
          if (current.goalTons !== input.goalTons) summary.settingsChanges++;
          data.goalTons = input.goalTons;
        }
        if (kind === 'line-downtime' && manifest.includeSettings && input.reasons) {
          data.reasons = [...new Set([...(current.reasons || []), ...input.reasons])];
          if (!same(current.reasons, data.reasons)) summary.settingsChanges++;
        }
      }
      try { validateData(kind, data); } catch { summary.conflicts++; }
      if (Buffer.byteLength(JSON.stringify(data)) > limits.jsonBytes) throw problem(413, 'TOO_LARGE');
      if (!same(current, data)) updates[kind] = data;
      summaries[kind] = summary;
    }
    const files = {total: manifest.files.length, added: 0, duplicates: 0, conflicts: 0, missing: 0};
    const fileUpdates = [], directories = new Set();
    const getNode = (name, content = false) => {
      const row = store.db.prepare('SELECT kind,revision' + (content ? ',content' : '') + ' FROM files WHERE path=?').get(name);
      snapshot.files[name] = row ? {kind: row.kind, revision: row.revision} : null;
      return row;
    };
    const pending = new Set(manifest.files.map(file => file.path));
    for (const [index, file] of manifest.files.entries()) {
      const local = path.join(directory, id, String(index));
      if (!fs.existsSync(local)) { files.missing++; continue; }
      const current = getNode(file.path, true);
      if (current && (current.kind !== 'file' || !Buffer.from(current.content).equals(fs.readFileSync(local)))) files.conflicts++;
      else if (current) files.duplicates++;
      else { files.added++; fileUpdates.push({index, ...file}); }
      const parts = file.path.split('/'); parts.pop();
      while (parts.length) {
        const name = parts.join('/'); const node = getNode(name);
        if (node && node.kind !== 'directory') files.conflicts++;
        else if (!node) directories.add(name);
        parts.pop();
      }
    }
    // An imported index must be usable immediately. Referenced attachments cannot be silently omitted.
    for (const profile of Object.values(manifest.documents['package-instructions'] || {})) {
      const folder = 'data/profiles/' + profile.folderName;
      const node = getNode(folder);
      if (node && node.kind !== 'directory') files.conflicts++;
      else if (!node) directories.add(folder);
      // Include all parents even for a profile with no attachments.
      const parts = folder.split('/'); parts.pop();
      while (parts.length) { const name = parts.join('/'), parent = getNode(name); if (parent && parent.kind !== 'directory') files.conflicts++; else if (!parent) directories.add(name); parts.pop(); }
      for (const leaf of profile.images) {
        const name = safePath(folder + '/' + leaf);
        const file = getNode(name);
        if (!pending.has(name) && (!file || file.kind !== 'file')) files.missing++;
      }
    }
    const conflicts = files.conflicts + Object.values(summaries).reduce((sum, summary) => sum + summary.conflicts, 0);
    const changes = Object.keys(updates).length + fileUpdates.length + directories.size;
    return {snapshot, updates, directories, fileUpdates, result: {documents: summaries, files, conflicts, changes, canApply: !conflicts && !files.missing && changes > 0}};
  }
  function preview(id, user) {
    const manifest = read(id, user), checked = plan(id, manifest), token = randomUUID();
    fs.writeFileSync(path.join(directory, id, 'preview.json'), JSON.stringify({token, snapshot: checked.snapshot}), {mode: 0o600});
    return {token, ...checked.result};
  }
  function apply(id, token, user) {
    const manifest = read(id, user);
    let prior;
    try { prior = JSON.parse(fs.readFileSync(path.join(directory, id, 'preview.json'), 'utf8')); } catch { throw problem(409, 'IMPORT_PREVIEW_REQUIRED'); }
    if (typeof token !== 'string' || token !== prior.token) throw problem(409, 'IMPORT_PREVIEW_REQUIRED');
    function checked() {
      const value = plan(id, manifest);
      if (!same(value.snapshot, prior.snapshot)) throw problem(409, 'CONFLICT');
      if (value.result.conflicts) throw problem(409, 'IMPORT_CONFLICT');
      if (value.result.files.missing) throw problem(400, 'IMPORT_FILES_MISSING');
      return value;
    }
    const before = checked();
    const backup = before.result.changes ? store.backupForImport() : false;
    const result = store.transaction(() => {
      const value = checked(), revisions = {};
      for (const [kind, data] of Object.entries(value.updates)) {
        store.db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data), kind);
        store.audit(user, 'import', kind); revisions[kind] = store.get(kind).revision;
      }
      for (const name of [...value.directories].sort((a, b) => a.split('/').length - b.split('/').length)) store.db.prepare("INSERT INTO files(path,kind) VALUES(?,'directory')").run(name);
      for (const file of value.fileUpdates) {
        const content = fs.readFileSync(path.join(directory, id, String(file.index)));
        store.db.prepare("INSERT INTO files(path,kind,content,mime) VALUES(?,'file',?,?)").run(file.path, content, file.mime);
      }
      if (value.fileUpdates.length || value.directories.size) { store.audit(user, 'attachments-import', 'package-instructions'); revisions['package-instructions'] = store.get('package-instructions').revision; }
      return {...value.result, revisions, backup};
    });
    try { discard(id, user); } catch { /* Completed staging expires privately; a committed import remains successful. */ }
    return result;
  }
  return {create, upload, preview, apply, discard: (id, user) => { read(id, user); discard(id, user); return {ok: true}; }, close: () => { if (temporary) fs.rmSync(directory, {recursive: true, force: true}); }};
}
module.exports = {createImports, limits};
