const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID, createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {DatabaseSync} = require('node:sqlite');
const {can, canViewModule, reports} = require('./permissions.cjs');
const {createProductionAccess} = require('./production-access.cjs');
const root = path.resolve(__dirname, '..');
const sandbox = vm.createContext({});
for (const file of ['shift-schedule', 'pair-targets-model', 'data-validation', 'personnel-model']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox);
const validate = vm.runInContext('HubDataValidation.validate', sandbox);
const pairModel = vm.runInContext('PairTargets', sandbox);
const personnelModel = vm.runInContext('PersonnelModel', sandbox);
const shiftSchedule = vm.runInContext('ShiftSchedule', sandbox);
const defaults = {
  'production-log': {entries: [], goalTons: 3000},
  'line-downtime': {entries: [], reasons: ['Друго']},
  personnel: {schemaVersion: 3, employees: [], settings: {stickersStage1: 4, stickersStage2: 6}, moveLog: []},
  'pair-targets': {module: 'pair-targets', schemaVersion: 1, entries: []},
  'package-instructions': {}
};
function problem(status, code) { const error = new Error(code); error.status = status; error.code = code; return error; }
function safePath(value) {
  if (typeof value !== 'string' || value.length > 1000 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part.length > 200)) throw problem(400, 'INVALID_PATH');
  return value;
}
// Bound recursion before schema checks, canonical signatures and JSON persistence.
function validateJSONDepth(value) {
  const pending = [{value, depth: 0}];
  while (pending.length) {
    const {value, depth} = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (depth > 64) throw new Error('JSON_DEPTH');
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push({value: child, depth: depth + 1});
  }
}
function validateData(kind, data) {
  if (!Object.hasOwn(defaults, kind)) throw problem(404, 'NOT_FOUND');
  try {
    validateJSONDepth(data);
    validate(kind, data);
    if (kind === 'package-instructions' && Object.keys(data).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error();
  } catch { throw problem(400, 'INVALID_DATA'); }
}
function validReason(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000; }
function reportChanges(before, after) {
  const {addedIds, changedIds} = notificationTargets(before, after);
  return {added: addedIds.length > 0, changed: changedIds.length > 0, content: !isDeepStrictEqual(before, after)};
}
function notificationTargets(before, after) {
  const prior = new Map((before.entries || []).map(entry => [entry.id, entry]));
  const next = new Map((after.entries || []).map(entry => [entry.id, entry]));
  const addedIds = [...next.keys()].filter(id => !prior.has(id));
  const changedIds = [...prior].filter(([id, entry]) => !isDeepStrictEqual(entry, next.get(id))).map(([id]) => id);
  // Identifiers stay in a private delivery table, outside the administrative audit.
  const profiles = new Set();
  if (!Array.isArray(before.entries) && !Array.isArray(after.entries)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (isDeepStrictEqual(before[key], after[key])) continue;
      for (const profile of [before[key], after[key]]) if (profile?.folderName) profiles.add(profile.folderName);
    }
  }
  return {addedIds, changedIds, profiles: [...profiles]};
}
function openStore(filename, {personnelNow = Date.now, productionNow = Date.now} = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(filename, {timeout: 5000});
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS documents(kind TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS report_versions(kind TEXT NOT NULL, entry_id TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(kind,entry_id));
    CREATE TABLE IF NOT EXISTS report_history(kind TEXT NOT NULL, entry_id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL, user_id INTEGER, account TEXT NOT NULL, reason TEXT NOT NULL, before_data TEXT, after_data TEXT, PRIMARY KEY(kind,entry_id,version));
    CREATE TABLE IF NOT EXISTS report_operations(user_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, signature TEXT NOT NULL, permission TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(user_id,kind,id));
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator','observer')), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('file','directory')), content BLOB, mime TEXT, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, module TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notification_targets(audit_id INTEGER PRIMARY KEY REFERENCES audit(id) ON DELETE CASCADE, data TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'");
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'task_supervisor')) {
    db.exec("ALTER TABLE users ADD COLUMN task_supervisor INTEGER NOT NULL DEFAULT 0; ALTER TABLE users ADD COLUMN task_team TEXT NOT NULL DEFAULT ''");
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE users ADD COLUMN deleted_at INTEGER');
  }
  if (!db.prepare('PRAGMA table_info(audit)').all().some(column => column.name === 'detail')) db.exec("ALTER TABLE audit ADD COLUMN detail TEXT NOT NULL DEFAULT '{}'");
  db.exec(`CREATE TABLE IF NOT EXISTS account_instruction_sets(
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_instruction_files(
      user_id INTEGER NOT NULL REFERENCES account_instruction_sets(user_id) ON DELETE CASCADE,
      path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('file','directory')), content BLOB, mime TEXT,
      PRIMARY KEY(user_id,path));
    CREATE TRIGGER IF NOT EXISTS remove_account_instructions AFTER UPDATE OF deleted_at ON users
      WHEN NEW.deleted_at IS NOT NULL BEGIN DELETE FROM account_instruction_sets WHERE user_id=NEW.id; END;`);
  db.exec('PRAGMA user_version=4');
  for (const [kind, data] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO documents(kind,data) VALUES(?,?)').run(kind, JSON.stringify(data));
  // Additive migration: existing reports receive their current document revision.
  // Deleted identities retain a tombstone version, so recreating an ID cannot
  // make a stale editor valid again.
  for (const kind of Object.keys(reports)) {
    const row = db.prepare('SELECT data,revision FROM documents WHERE kind=?').get(kind);
    for (const entry of JSON.parse(row.data).entries) db.prepare('INSERT OR IGNORE INTO report_versions VALUES(?,?,?)').run(kind, entry.id, row.revision);
  }
  db.prepare("INSERT OR IGNORE INTO files(path,kind) VALUES('data','directory'),('data/profiles','directory')").run();
  const get = kind => {
    const row = db.prepare('SELECT data, revision FROM documents WHERE kind=?').get(kind);
    if (!row) throw problem(404, 'NOT_FOUND');
    const data = JSON.parse(row.data);
    const ids = Object.hasOwn(reports, kind) ? new Set(data.entries.map(entry => entry.id)) : null;
    const savedVersions = ids ? new Map(db.prepare('SELECT entry_id,version FROM report_versions WHERE kind=?').all(kind).map(item => [item.entry_id,item.version])) : null;
    const versions = ids ? Object.fromEntries([...ids].map(id => [id,savedVersions.get(id) ?? row.revision])) : null;
    return {data, revision: row.revision, ...(versions ? {versions} : {})};
  };
  function audit(user, action, module, detail = {}, targets) {
    const result = db.prepare('INSERT INTO audit(at,user_id,action,module,detail) VALUES(?,?,?,?,?)').run(Date.now(), user?.id || null, action, module, JSON.stringify(detail));
    if (targets) db.prepare('INSERT INTO notification_targets(audit_id,data) VALUES(?,?)').run(result.lastInsertRowid, JSON.stringify(targets));
    return result;
  }
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function personnelDate() { return shiftSchedule.sofiaDate(new Date(personnelNow())); }
  function validatePersonnelChange(data, importing = false) {
    const before=get('personnel').data, today=personnelDate();
    const prior=new Map(before.employees.map(p=>[p.id,p])), next=new Map(data.employees.map(p=>[p.id,p]));
    try {
      if(before.schemaVersion===4 && data.schemaVersion!==4) throw new Error();
      for(const old of before.employees) if((old.transfers||[]).length && !next.has(old.id)) throw new Error();
      for(const row of data.employees) {
        const old=prior.get(row.id), history=row.transfers||[], pending=history.filter(t=>t.effectiveDate>today);
        if(pending.length>1 || row.active===false && pending.length) throw new Error();
        if(!old) { if(!importing && history.some(t=>t.effectiveDate<=today)) throw new Error(); continue; }
        const original=personnelModel.normalizeEmployee(old), normalized=personnelModel.normalizeEmployee(row);
        if(original.category!==normalized.category || original.team!==normalized.team) throw new Error();
        if(!isDeepStrictEqual((old.transfers||[]).filter(t=>t.effectiveDate<=today),history.filter(t=>t.effectiveDate<=today))) throw new Error();
      }
    } catch { throw problem(400,'INVALID_PERSONNEL_CHANGE'); }
  }
  function updateDocument(kind, data, user, context = {}) {
    if(kind==='personnel') { validateData(kind,data); validatePersonnelChange(data,context.personnelImport===true); }
    const before = get(kind);
    if (Object.hasOwn(reports, kind)) {
      const prior = new Map(before.data.entries.map(entry => [entry.id, entry]));
      const next = new Map(data.entries.map(entry => [entry.id, entry]));
      for (const id of prior.keys()) db.prepare('INSERT OR IGNORE INTO report_versions VALUES(?,?,?)').run(kind,id,before.versions[id]);
      for (const id of new Set([...prior.keys(), ...next.keys()])) {
        if (!isDeepStrictEqual(prior.get(id), next.get(id))) {
          const old = prior.get(id), value = next.get(id);
          if (!old && context.action !== 'restore' && db.prepare('SELECT 1 FROM report_versions WHERE kind=? AND entry_id=?').get(kind,id)) throw problem(409,'REPORT_CONFLICT');
          const firstPairReport = kind === 'pair-targets' && old && !old.result && !old.cancellation && value?.result &&
            isDeepStrictEqual(Object.fromEntries(Object.entries(old).filter(([key]) => !['result','areas','updatedAt'].includes(key))), Object.fromEntries(Object.entries(value).filter(([key]) => !['result','areas','updatedAt'].includes(key))));
          const cancellationReason = kind === 'pair-targets' && old && !old.result && !old.cancellation && value?.cancellation ?
            value.cancellation.reasonText || pairModel.CANCELLATION_REASONS.find(item => item.key === value.cancellation.reasonKey)?.label : undefined;
          const reason = context.reason || cancellationReason;
          if (old && !firstPairReport && !validReason(reason)) throw problem(428, 'CORRECTION_REASON_REQUIRED');
          db.prepare('INSERT INTO report_versions VALUES(?,?,?) ON CONFLICT(kind,entry_id) DO UPDATE SET version=excluded.version').run(kind, id, before.revision + 1);
          db.prepare('INSERT INTO report_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(kind,id,before.revision+1,context.action || (old ? value ? 'update' : 'delete' : 'create'),Date.now(),user?.id || null,user?.username || '',reason?.trim() || '',old ? JSON.stringify(old) : null,value ? JSON.stringify(value) : null);
        }
      }
    }
    db.prepare('UPDATE documents SET data=?,revision=revision+1 WHERE kind=?').run(JSON.stringify(data), kind);
  }
  function put(kind, data, revision, user, mode = 'report', withinTransaction = false, context = {}) {
    validateData(kind, data);
    if (!canViewModule(user, kind)) throw problem(403, 'FORBIDDEN');
    if (context.reason !== undefined && !validReason(context.reason)) throw problem(400,'INVALID_OPERATION');
    const work = () => {
      const current = get(kind);
      if (current.revision !== revision) throw problem(409, 'CONFLICT');
      const report = reports[kind], importing = mode === 'import' && can(user, 'canImportData');
      if (report && !importing) {
        if (!can(user, report.create) && !can(user, report.edit) && !(report.settings && can(user, report.settings))) throw problem(403, 'FORBIDDEN');
        const next = new Map(data.entries.map(entry => [entry.id, entry]));
        const prior = new Map(current.data.entries.map(entry => [entry.id, entry]));
        // Planning and a first pair result are ordinary reporting; correcting a
        // completed result or removing an existing report requires edit rights.
        const corrected = current.data.entries.some(entry => {
          const value = next.get(entry.id);
          return kind === 'pair-targets' ? !!entry.result && !isDeepStrictEqual(entry, value) : !isDeepStrictEqual(entry, value);
        });
        const added = data.entries.some(entry => !prior.has(entry.id) || kind === 'pair-targets' && !isDeepStrictEqual(prior.get(entry.id), entry) && !prior.get(entry.id)?.result) || kind === 'pair-targets' && current.data.entries.some(entry => !entry.result && !next.has(entry.id));
        const metadata = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'entries'));
        if (corrected && !can(user, report.edit) || added && !['restore','delete'].includes(context.action) && !can(user, report.create) || !isDeepStrictEqual(metadata(current.data), metadata(data)) && !can(user, report.settings || report.edit)) throw problem(403, 'FORBIDDEN');
      }
      if (!report && !importing && !can(user, kind === 'personnel' ? 'canManagePersonnel' : 'canManageInstructions')) throw problem(403, 'FORBIDDEN');
      if(kind==='production-log'&&!importing)productionAccess.requireChanges(current.data,data,user,context.reason);
      if (kind === 'pair-targets') {
        try {
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          const planFields = ['id', 'date', 'shiftCode', 'team', 'members', 'targetKg', 'targetCrates', 'createdAt'];
          const remaining = new Set(data.entries.map(entry => entry.id));
          // Ordinary planning keeps cancelled snapshots immutable. Deletions
          // and restores use protected history and the record operation checks.
          if (context.action !== 'delete' && current.data.entries.some(entry => !remaining.has(entry.id))) throw new Error();
          for (const entry of data.entries) {
            const previous = current.data.entries.find(item => item.id === entry.id);
            if (previous && isDeepStrictEqual(previous, entry)) continue;
            // A restore uses an already-validated historical snapshot. Schema
            // and duplicate-membership checks still run in validateData(), but
            // today's roster must not rewrite or reject historical membership.
            if (!previous && context.action === 'restore') continue;
            if (previous?.cancellation) throw new Error();
            if (entry.cancellation) {
              if (!previous) throw new Error();
              const cancelled = pairModel.cancel(previous, {context: entry, ...entry.cancellation, now: entry.cancellation.cancelledAt});
              if (!isDeepStrictEqual(JSON.parse(JSON.stringify(cancelled)), entry)) throw new Error();
              continue;
            }
            if (!previous || planFields.some(field => !same(previous[field], entry[field]))) {
              const planned = pairModel.plan({data: {...current.data, entries: current.data.entries.filter(item => remaining.has(item.id))}, employees: get('personnel').data.employees, context: entry, memberIds: entry.members.map(person => person.id), targetKg: entry.targetKg, targetCrates: entry.targetCrates, workAreas: entry.areas, existingId: previous?.id, id: entry.id, now: entry.createdAt});
              if (planFields.some(field => !same(planned[field], entry[field]))) throw new Error();
            }
            if (previous?.result && !entry.result) throw new Error();
            if (entry.result) {
              const reported = pairModel.report(entry, {context: entry, ...entry.result, workAreas: entry.areas, now: entry.result.reportedAt});
              if (!same(reported.result, entry.result)) throw new Error();
            }
          }
        } catch { throw problem(400, 'INVALID_PAIR_CHANGE'); }
      }
      updateDocument(kind, data, user, {...context,personnelImport:importing});
      audit(user, 'write', kind, reportChanges(current.data, data), notificationTargets(current.data, data));
      return get(kind);
    };
    return withinTransaction ? work() : transaction(work);
  }
  function reportOperation(kind, input, expected, user) {
    const report = reports[kind];
    if (!report) throw problem(404, 'NOT_FOUND');
    if (!canViewModule(user, kind)) throw problem(403, 'FORBIDDEN');
    try { validateJSONDepth(input); } catch { throw problem(400, 'INVALID_OPERATION'); }
    if (!input || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId) ||
      !['create','update','delete','restore'].includes(input.action) || typeof input.entryId !== 'string' || !input.entryId.trim() || input.entryId.length > 200 ||
      Object.keys(input).some(key => !['operationId','action','entryId','entry','reason','sourceVersion'].includes(key)) ||
      (['create','update'].includes(input.action) && (!input.entry || input.entry.id !== input.entryId)) || ['delete','restore'].includes(input.action) && input.entry !== undefined || input.reason !== undefined && !validReason(input.reason) || (input.action === 'restore' ? !Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1 : input.sourceVersion !== undefined)) throw problem(400, 'INVALID_OPERATION');
    if (input.action !== 'create' && (!Number.isSafeInteger(expected) || expected < 1)) throw problem(428, 'REVISION_REQUIRED');
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const signature = createHash('sha256').update(JSON.stringify(canonical({input, expected: expected ?? null}))).digest('hex');
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM report_operations WHERE user_id=? AND kind=? AND id=?').get(user.id, kind, input.operationId);
      if (previous) {
        if (!can(user, previous.permission)) throw problem(403, 'FORBIDDEN');
        if (previous.signature !== signature) throw problem(409, 'OPERATION_REUSED');
        return {...get(kind), receipt: JSON.parse(previous.receipt), replayed: true};
      }
      const current = get(kind), entry = current.data.entries.find(item => item.id === input.entryId);
      const permission = kind === 'pair-targets' && input.action === 'update' && !entry?.result ? report.create : input.action === 'create' ? report.create : report.edit;
      if (!can(user, permission)) throw problem(403, 'FORBIDDEN');
      const version = db.prepare('SELECT version FROM report_versions WHERE kind=? AND entry_id=?').get(kind,input.entryId)?.version ?? current.versions[input.entryId];
      if (input.action === 'create' ? !!entry || version !== undefined : input.action === 'restore' ? !!entry || version !== expected : !entry || version !== expected) throw problem(409, 'REPORT_CONFLICT');
      if (permission === report.edit && !validReason(input.reason)) throw problem(428, 'CORRECTION_REASON_REQUIRED');
      let restored;
      if (input.action === 'restore') {
        const source = db.prepare('SELECT before_data,after_data FROM report_history WHERE kind=? AND entry_id=? AND version=?').get(kind,input.entryId,input.sourceVersion);
        if (!source) throw problem(404, 'NOT_FOUND');
        restored = JSON.parse(source.after_data || source.before_data);
        if (kind === 'pair-targets' && !restored.cancellation && current.data.entries.some(item => !item.cancellation && pairModel.inScope(item,restored) && item.members.some(person => restored.members.some(member => member.id === person.id)))) throw problem(409,'REPORT_CONFLICT');
      }
      const entries = input.action === 'restore' ? [...current.data.entries, restored] : input.action === 'create' ? [...current.data.entries, input.entry] : input.action === 'delete' ? current.data.entries.filter(item => item.id !== input.entryId) : current.data.entries.map(item => item.id === input.entryId ? input.entry : item);
      const saved = put(kind, {...current.data, entries}, current.revision, user, 'report', true, {reason:input.reason,action:input.action});
      const receipt = {operationId: input.operationId, entryId: input.entryId, action: input.action, version: saved.versions[input.entryId] ?? saved.revision, status: 'confirmed', message: input.action === 'delete' ? 'REPORT_DELETED' : input.action === 'restore' ? 'REPORT_RESTORED' : 'REPORT_SAVED'};
      db.prepare('INSERT INTO report_operations VALUES(?,?,?,?,?,?)').run(user.id, kind, input.operationId, signature, permission, JSON.stringify(receipt));
      return {...saved, receipt, replayed: false};
    });
  }
  function historyAccess(kind, user) {
    if (!Object.hasOwn(reports,kind)) throw problem(404,'NOT_FOUND');
    if (!canViewModule(user,kind) || !can(user,reports[kind].edit)) throw problem(403,'FORBIDDEN');
  }
  function historyNumber(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw problem(400,'INVALID_HISTORY_FILTER');
    return Number(value);
  }
  function historyEvent(row) {
    const {user_id,before_data,after_data,...event} = row;
    return {...event,accountId:user_id,...(before_data !== undefined ? {before:JSON.parse(before_data),after:JSON.parse(after_data)} : {})};
  }
  function reportHistorySnapshot(kind, entryId, version, user) {
    historyAccess(kind,user);
    const row = db.prepare('SELECT version,action,at,user_id,account,reason,before_data,after_data FROM report_history WHERE kind=? AND entry_id=? AND version=?').get(kind,entryId,historyNumber(version));
    if (!row) throw problem(404,'NOT_FOUND');
    return historyEvent(row);
  }
  function reportHistory(kind, entryId, user, options = {}) {
    historyAccess(kind,user);
    // Read one live record, without constructing every report and its version map.
    const current = db.prepare("SELECT revision,(SELECT value FROM json_each(documents.data,'$.entries') WHERE json_extract(value,'$.id')=? LIMIT 1) AS entry FROM documents WHERE kind=?").get(entryId,kind);
    const live = current.entry ? JSON.parse(current.entry) : null;
    const version = db.prepare('SELECT version FROM report_versions WHERE kind=? AND entry_id=?').get(kind,entryId)?.version ?? (live ? current.revision : undefined);
    if (!version) throw problem(404,'NOT_FOUND');
    const limit = Math.min(historyNumber(options.limit,20),50), before = historyNumber(options.beforeVersion,Number.MAX_SAFE_INTEGER);
    const fields = 'version,action,at,user_id,account,reason' + (options.metadataOnly ? '' : ',before_data,after_data');
    const rows = db.prepare('SELECT '+fields+' FROM report_history WHERE kind=? AND entry_id=? AND version<? ORDER BY version DESC LIMIT ?').all(kind,entryId,before,limit+1);
    const events = rows.slice(0,limit).map(historyEvent);
    return {entryId,version,deleted:!live,current:live,events,nextVersion:rows.length > limit ? events.at(-1).version : null};
  }
  function reportHistoryList(kind, user, options = {}) {
    historyAccess(kind,user);
    const limit = Math.min(historyNumber(options.limit,25),50), date = options.date || '';
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) throw problem(400,'INVALID_HISTORY_FILTER');
    let cursor = {version:Number.MAX_SAFE_INTEGER,id:''};
    if (options.cursor) {
      try { if (typeof options.cursor !== 'string' || options.cursor.length > 16384) throw new Error(); cursor = JSON.parse(Buffer.from(options.cursor,'base64url').toString()); if (!cursor || !Number.isSafeInteger(cursor.version) || cursor.version < 1 || typeof cursor.id !== 'string' || !cursor.id) throw new Error(); }
      catch { throw problem(400,'INVALID_HISTORY_FILTER'); }
    }
    // Project only list metadata in SQLite, including legacy and deleted records.
    const rows = db.prepare(`WITH live AS (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.date') AS date,
        coalesce(json_extract(value,'$.shift'),json_extract(value,'$.team')) AS shift
      FROM documents,json_each(documents.data,'$.entries') WHERE kind=?
    ), records AS (
      SELECT v.entry_id AS entryId,v.version,l.id IS NULL AS deleted,
        coalesce(l.date,json_extract(coalesce(h.after_data,h.before_data),'$.date')) AS date,
        coalesce(l.shift,json_extract(coalesce(h.after_data,h.before_data),'$.shift'),json_extract(coalesce(h.after_data,h.before_data),'$.team')) AS shift
      FROM report_versions v LEFT JOIN live l ON l.id=v.entry_id
      LEFT JOIN report_history h ON h.kind=v.kind AND h.entry_id=v.entry_id AND h.version=v.version WHERE v.kind=?
      UNION ALL SELECT l.id,d.revision,0,l.date,l.shift FROM live l JOIN documents d ON d.kind=?
      WHERE NOT EXISTS(SELECT 1 FROM report_versions v WHERE v.kind=d.kind AND v.entry_id=l.id)
    ) SELECT * FROM records WHERE (?='' OR date=?) AND (version<? OR (version=? AND entryId>?))
      ORDER BY version DESC,entryId COLLATE BINARY LIMIT ?`).all(kind,kind,kind,date,date,cursor.version,cursor.version,cursor.id,limit+1);
    const entries = rows.slice(0,limit).map(row => ({...row,deleted:!!row.deleted}));
    const last = entries.at(-1);
    return {entries,nextCursor:rows.length > limit ? Buffer.from(JSON.stringify({version:last.version,id:last.entryId})).toString('base64url') : null};
  }
  function productionImport(input, user) {
    if (!can(user, 'canImportData') || !canViewModule(user, 'production-log')) throw problem(403, 'FORBIDDEN');
    validateData('production-log', input);
    const current = get('production-log');
    const existing = new Map(current.data.entries.map(entry => [entry.id, entry]));
    const added = []; let duplicates = 0, conflicts = 0, firstDate = null, lastDate = null, kg = 0, scrapKg = 0;
    for (const entry of input.entries) {
      firstDate = firstDate === null || entry.date < firstDate ? entry.date : firstDate;
      lastDate = lastDate === null || entry.date > lastDate ? entry.date : lastDate;
      kg += entry.tonnage; scrapKg += entry.brak;
      const prior = existing.get(entry.id);
      if (!prior) added.push(entry);
      else if (isDeepStrictEqual({...prior, breakdown: prior.breakdown ?? null}, {...entry, breakdown: entry.breakdown ?? null})) duplicates++;
      else conflicts++;
    }
    return {current, added, summary: {revision: current.revision, total: input.entries.length, added: added.length, duplicates, conflicts, firstDate, lastDate, kg, scrapKg}};
  }
  const previewProductionImport = (input, user) => productionImport(input, user).summary;
  function backupForImport() {
    if (filename === ':memory:') return false;
    const directory = path.join(path.dirname(filename), 'import-backups');
    const backup = path.join(directory, randomUUID() + '.sqlite');
    try { fs.mkdirSync(directory, {recursive: true, mode: 0o700}); db.prepare('VACUUM INTO ?').run(backup); fs.chmodSync(backup, 0o600); }
    catch { throw problem(500, 'BACKUP_FAILED'); }
    return true;
  }
  function applyProductionImport(input, revision, user) {
    const plan = productionImport(input, user);
    if (plan.current.revision !== revision) throw problem(409, 'CONFLICT');
    if (plan.summary.conflicts) throw problem(409, 'IMPORT_CONFLICT');
    if (!plan.added.length) return {...plan.summary, backup: false};
    // A private, consistent snapshot lives beside the database, outside static assets.
    // VACUUM cannot run inside a transaction. put() rechecks the revision atomically.
    const backup = backupForImport();
    const saved = put('production-log', {...plan.current.data, entries: [...plan.current.data.entries, ...plan.added]}, revision, user, 'import');
    return {...plan.summary, revision: saved.revision, backup};
  }
  function node(name) {
    safePath(name);
    if (name === 'data/package-instructions.json') {
      const current = get('package-instructions');
      return {kind: 'file', content: Buffer.from(JSON.stringify(current.data)), mime: 'application/json', revision: current.revision};
    }
    const result = db.prepare('SELECT * FROM files WHERE path=?').get(name);
    if (!result) throw problem(404, 'NOT_FOUND');
    return result;
  }
  function createNode(name, kind, user) {
    safePath(name);
    if (!can(user, 'canManageInstructions')) throw problem(403, 'FORBIDDEN');
    if (!['directory', 'file'].includes(kind)) throw problem(400, 'WRONG_KIND');
    const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    if (parent && node(parent).kind !== 'directory') throw problem(400, 'INVALID_PATH');
    if (name === 'data/package-instructions.json') {
      if (kind !== 'file') throw problem(400, 'WRONG_KIND');
      return node(name);
    }
    db.prepare('INSERT OR IGNORE INTO files(path,kind,content,mime) VALUES(?,?,?,?)').run(name, kind, kind === 'file' ? Buffer.alloc(0) : null, 'application/octet-stream');
    const result = node(name);
    if (result.kind !== kind) throw problem(400, 'WRONG_KIND');
    return result;
  }
  function writeFile(name, content, mime, revision, user) {
    if (!can(user, 'canManageInstructions')) throw problem(403, 'FORBIDDEN');
    if (name === 'data/package-instructions.json') {
      let data;
      try { data = JSON.parse(content.toString('utf8')); } catch { throw problem(400, 'INVALID_DATA'); }
      return put('package-instructions', data, revision, user);
    }
    return transaction(() => {
      const current = node(name);
      if (current.kind !== 'file') throw problem(400, 'WRONG_KIND');
      if (current.revision !== revision) throw problem(409, 'CONFLICT');
      db.prepare('UPDATE files SET content=?,mime=?,revision=revision+1 WHERE path=?').run(content, mime, name);
      const profiles = Object.values(get('package-instructions').data).filter(profile => name.startsWith('data/profiles/' + profile.folderName + '/')).map(profile => profile.folderName);
      audit(user, 'attachment-write', 'package-instructions', {}, {profiles});
      return {revision: current.revision + 1};
    });
  }
  function children(name) {
    if (name && node(name).kind !== 'directory') throw problem(400, 'WRONG_KIND');
    const prefix = name ? name + '/' : '';
    const list = db.prepare('SELECT path,kind FROM files').all().filter(row => row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes('/')).map(row => ({name: row.path.slice(prefix.length), kind: row.kind}));
    if (name === 'data') list.push({name: 'package-instructions.json', kind: 'file'});
    return list;
  }
  const productionAccess=createProductionAccess({db,audit,transaction},{schedule:shiftSchedule,problem,now:productionNow});
  return {db, get, put, productionAccess, updateDocument, personnelDate, validatePersonnelChange, reportOperation, reportHistory, reportHistoryList, reportHistorySnapshot, previewProductionImport, applyProductionImport, backupForImport, node, createNode, writeFile, children, audit, transaction, close: () => db.close()};
}
module.exports = {openStore, defaults, problem, safePath, validateData, personnelModel, shiftSchedule, reportChanges, notificationTargets};
