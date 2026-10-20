/* Durable local inbox. External Web Push has no message payload. */
const {randomUUID} = require('node:crypto');
const {problem} = require('./store.cjs');
const permissions = require('./permissions.cjs');
const {can} = permissions;
const {types, available, href} = require('../js/notification-model.js');
const {createWebPush, validateSubscription} = require('./web-push.cjs');
const {createShiftCloseout,scopeFromTarget} = require('./shift-closeout.cjs');
function createNotifications(store, {now = Date.now, push = {}, taskNow = now} = {}) {
  const {db} = store, transport = createWebPush({...push, now});
  db.exec(`CREATE TABLE IF NOT EXISTS notification_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notification_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, target TEXT, at INTEGER NOT NULL, read_at INTEGER, event_key TEXT NOT NULL, UNIQUE(user_id,event_key));
    CREATE INDEX IF NOT EXISTS notifications_user_at ON notifications(user_id,at);
    CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(user_id,read_at,type);
    CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), session_hash TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_queue(subscription_id TEXT PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE, next_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 1);`);
  const state = key => db.prepare('SELECT value FROM notification_state WHERE key=?').get(key)?.value;
  const saveState = (key, value) => db.prepare('INSERT INTO notification_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  const closeout=createShiftCloseout(store,{now:taskNow});
  if(state('closeout:activation')===undefined)saveState('closeout:activation',taskNow());
  const userFrom = row => ({...row, taskSupervisor: !!row.task_supervisor, taskTeam:row.task_team, permissionOverrides: JSON.parse(row.permissions || '{}')});
  const users = () => db.prepare('SELECT * FROM users WHERE active=1 AND deleted_at IS NULL').all().map(userFrom);
  const settings = user => JSON.parse(db.prepare('SELECT data FROM notification_preferences WHERE user_id=?').get(user.id)?.data || '{}');
  const allowed = (user, type) => available(type, user, permissions);
  const enabled = (user, type) => allowed(user, type) && settings(user)[type] !== false;
  const access = user => { if (!can(user, 'canViewNotifications')) throw problem(403, 'FORBIDDEN'); };
  function task(target) {
    const row = db.prepare('SELECT data FROM task_items WHERE id=?').get(target) || db.prepare('SELECT data FROM task_schedules WHERE id=?').get(target);
    return row && JSON.parse(row.data);
  }
  function taskVisible(item, user) {
    return item && (!user.taskSupervisor || can(user, 'canManageTasks') || can(user, 'canReviewTasks') || item.owner.id === user.id || item.participants.some(p => p.id === user.id) || can(user, 'canAssignTasks') && item.events.some(e => e.action === 'created' && e.actor.id === user.id));
  }
  const targetVisible = (type, target, user) => {
    if(types[type]?.module==='shift-closeout') {
      try {const value=closeout.read(scopeFromTarget(target),user);return !!(value.availability?.production||value.availability?.pairs);}
      catch {return false;}
    }
    return types[type]?.module !== 'tasks' || !target || taskVisible(task(target), user);
  };
  const visible = (item, user) => allowed(user, item.type) && targetVisible(item.type, item.target, user);
  function emit(type, eventKey, targets, target = null, at = now()) {
    for (const user of targets) {
      if (!enabled(user, type) || !targetVisible(type, target, user)) continue;
      const result = db.prepare('INSERT OR IGNORE INTO notifications(id,user_id,type,target,at,event_key) VALUES(?,?,?,?,?,?)').run(randomUUID(), user.id, type, target, at, eventKey + ':' + type);
      if (!result.changes) continue;
      for (const subscription of db.prepare('SELECT id FROM push_subscriptions WHERE user_id=?').all(user.id)) {
        db.prepare('INSERT INTO push_queue(subscription_id,next_at) VALUES(?,?) ON CONFLICT(subscription_id) DO UPDATE SET generation=generation+1').run(subscription.id, now());
      }
    }
  }
  const allTasks = table => db.prepare(`SELECT id,data FROM ${table}`).all().map(row => ({id: row.id, ...JSON.parse(row.data)}));
  const existingInstallation = state('audit') !== undefined;
  if (state('audit') === undefined) {
    // First installation starts with future events, rather than replaying private history.
    saveState('audit', db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit').get().n);
    db.prepare('DELETE FROM notification_targets WHERE audit_id<=?').run(Number(state('audit')));
    for (const table of ['task_items', 'task_schedules']) for (const item of allTasks(table)) saveState('task:' + item.id, item.events?.length || 0);
  }
  // Existing installations announce the new wall once to everyone allowed to read it.
  if (state('wall:opened') === undefined) store.transaction(() => { if (existingInstallation) emit('wallOpened', 'wall:opened', users()); saveState('wall:opened', 1); });
  function sync() {
    store.transaction(() => {
      const roster = users();
      const changes = db.prepare('SELECT a.id,a.at,a.user_id,a.action,a.module,a.detail,t.data AS targets FROM audit a LEFT JOIN notification_targets t ON t.audit_id=a.id WHERE a.id>? ORDER BY a.id LIMIT 1000').all(Number(state('audit')));
      for (const change of changes) {
        const detail = JSON.parse(change.detail), targets = JSON.parse(change.targets || '{}'), key = 'audit:' + change.id;
        const records = (type, ids) => {
          if (Array.isArray(ids) && ids.length) for (const id of new Set(ids)) emit(type, key + ':target:' + id, roster, id, change.at);
          else emit(type, key, roster, null, change.at);
        };
        if (['write', 'import'].includes(change.action)) {
          const prefix = {'production-log': 'production', 'line-downtime': 'downtime'}[change.module];
          if (prefix) {
            if (detail.added) records(prefix + 'Added', targets.addedIds);
            if (detail.changed) records(prefix + 'Changed', targets.changedIds);
          } else if (detail.content && change.module === 'pair-targets') records('pairs', [...(targets.addedIds || []), ...(targets.changedIds || [])]);
          else if (detail.content && change.module === 'package-instructions') records('instructions', targets.profiles);
        }
        if (change.action === 'wall-post' && change.module === 'wall') emit('wallPost', key, roster.filter(user => user.id !== change.user_id), null, change.at);
        if (['attachment-write', 'attachments-import'].includes(change.action) && change.module === 'package-instructions') records('instructions', targets.profiles);
        saveState('audit', change.id);
        db.prepare('DELETE FROM notification_targets WHERE audit_id=?').run(change.id);
      }
      const at = taskNow();
      for(const user of roster) {
        if(!can(user,'canViewShiftCloseout') || user.role!=='admin' && !user.taskSupervisor)continue;
        for(const candidate of closeout.reminderCandidates(at,user)) {
          if(candidate.dueAt<Number(state('closeout:activation')))continue;
          const type=candidate.phase==='due'?'shiftCloseoutDue':'shiftCloseoutOverdue';
          const key='closeout:'+candidate.target+':'+candidate.phase+':'+user.id;
          if(state(key)!==undefined || !enabled(user,type))continue;
          emit(type,key,[user],candidate.target);
          saveState(key,1);
        }
      }
      // Only items with unseen events, or open items that may need a reminder, are read.
      const pending = table => db.prepare(`SELECT id,data FROM ${table} WHERE json_array_length(data,'$.events')>COALESCE((SELECT CAST(value AS INTEGER) FROM notification_state WHERE key='task:'||${table}.id),0)
        ${table === 'task_items' ? "OR json_extract(data,'$.status') IN ('pending','in-progress','blocked')" : ''}`).all().map(row => ({id: row.id, ...JSON.parse(row.data)}));
      for (const table of ['task_items', 'task_schedules']) for (const item of pending(table)) {
        if (!Array.isArray(item.events) || !item.owner || !Array.isArray(item.participants)) continue;
        const cursor = Number(state('task:' + item.id) || 0);
        for (let i = cursor; i < item.events.length; i++) {
          const event = item.events[i], snapshot = event.snapshot || item;
          if (i === 0 && item.scheduleId && item.shift.start <= item.createdAt) continue;
          const assigned = event.action === 'transfer' && event.transfer ? [event.transfer.to.id] : [snapshot.owner.id, ...snapshot.participants.map(p => p.id)];
          const creator = item.events.find(e => e.action === 'created')?.actor.id;
          const key = 'task:' + item.id + ':' + i;
          const recipients = roster.filter(user => assigned.includes(user.id) && (event.action === 'transfer' || user.id !== event.actor.id));
          if (['report', 'progress'].includes(event.action)) {
            emit('taskReport', key, roster.filter(user => user.id === creator && user.id !== event.actor.id), item.id, event.at);
            if (event.status === 'review' && event.action === 'report') emit('taskReview', key, roster.filter(user => user.id !== event.actor.id && can(user, 'canReviewTasks')), item.id, event.at);
          } else {
            const type = ['created', 'transfer'].includes(event.action) ? 'taskAssigned' : ['approve', 'complete', 'cancel', 'stop'].includes(event.action) ? 'taskOutcome' : 'taskChanged';
            // Recurring instances notify when their shift starts, independently of the initial plan.
            emit(type, key, recipients, item.id, item.scheduleId && i === 0 ? now() : event.at);
          }
        }
        if (cursor !== item.events.length) saveState('task:' + item.id, item.events.length);
        if (table !== 'task_items' || !['pending', 'in-progress', 'blocked'].includes(item.status) || item.kind === 'shift' && item.shift.start > at) continue;
        const recipients = roster.filter(user => [item.owner.id, ...item.participants.map(p => p.id)].includes(user.id));
        const cycle = item.events.filter(e => ['edit', 'reopen', 'return', 'transfer'].includes(e.action)).length;
        function remind(type) {
          const key = type + ':' + item.id + ':' + cycle;
          if (state(key) === undefined) { emit(type, key, recipients, item.id); saveState(key, 1); }
        }
        if (at >= item.due - 30 * 60000 && at < item.due) remind('taskDue');
        if (at >= item.due + (item.kind === 'shift' ? 30 * 60000 : 0)) remind('taskOverdue');
      }
      db.prepare('DELETE FROM notifications WHERE at<?').run(now() - 90 * 86400000);
      for (const user of roster) db.prepare('DELETE FROM notifications WHERE user_id=? AND id NOT IN (SELECT id FROM notifications WHERE user_id=? ORDER BY at DESC,rowid DESC LIMIT 1000)').run(user.id, user.id);
    });
  }
  // Hourly: a closed task's reminder keys are never read again (reopening starts a new cycle),
  // and shift-closeout reminders only look two days back.
  function prune() {
    const at = taskNow(), cutoff = at - 30 * 86400000;
    store.transaction(() => {
      db.prepare(`DELETE FROM notification_state WHERE (key LIKE 'taskDue:%' OR key LIKE 'taskOverdue:%') AND EXISTS(SELECT 1 FROM task_items i
        WHERE i.id=substr(rtrim(key,'0123456789'),instr(key,':')+1,length(rtrim(key,'0123456789'))-instr(key,':')-1)
        AND json_extract(i.data,'$.closedAt')<? AND json_extract(i.data,'$.status') NOT IN ('pending','in-progress','blocked'))`).run(cutoff);
      db.prepare("DELETE FROM notification_state WHERE key GLOB 'closeout:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/*' AND substr(key,10,10)<?").run(new Date(cutoff).toISOString().slice(0, 10));
    });
  }
  function list(user, before) {
    access(user);
    if (before !== null && before !== undefined && (!/^\d{1,16}$/.test(before) || !Number.isSafeInteger(Number(before)))) throw problem(400, 'INVALID_DATA');
    const rows = db.prepare('SELECT rowid AS sequence,* FROM notifications WHERE user_id=? ORDER BY rowid DESC').all(user.id).filter(item => visible(item, user));
    const page = rows.filter(item => !before || item.sequence < Number(before));
    const pageSize = 3, items = page.slice(0, pageSize);
    return {count: rows.filter(item => item.read_at === null).length, nextBefore: page.length > pageSize ? String(items.at(-1).sequence) : null,
      items: items.map(item => ({id: item.id, type: item.type, text: types[item.type].text, at: item.at, read: item.read_at !== null, href: href(item.type, item.target)}))};
  }
  function summary(user) {
    access(user);
    const permitted = Object.keys(types).filter(type => allowed(user,type));
    if (!permitted.length) return {count:0};
    // Read no inbox text or read notifications; check current target visibility.
    const rows = db.prepare(`SELECT type,target,count(*) AS count FROM notifications
      WHERE user_id=? AND read_at IS NULL AND type IN (${permitted.map(() => '?').join(',')}) GROUP BY type,target`).all(user.id,...permitted);
    const targets = new Map();
    return {count:rows.reduce((count,row) => {
      if (!['tasks','shift-closeout'].includes(types[row.type]?.module) || !row.target) return count + row.count;
      const key=row.type+':'+row.target;
      if (!targets.has(key)) targets.set(key,targetVisible(row.type,row.target,user));
      return count + (targets.get(key) ? row.count : 0);
    },0)};
  }
  function preferences(user) {
    access(user);
    return {types: Object.entries(types).filter(([key, value]) => !value.once && allowed(user, key)).map(([key, value]) => ({key, label: value.label, enabled: settings(user)[key] !== false})), publicKey: transport.publicKey};
  }
  function updatePreferences(input, user) {
    access(user);
    if (!input || Object.keys(input).some(key => !allowed(user, key) || typeof input[key] !== 'boolean')) throw problem(400, 'INVALID_DATA');
    db.prepare('INSERT INTO notification_preferences(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data').run(user.id, JSON.stringify({...settings(user), ...input}));
    return preferences(user);
  }
  function read(input, user) {
    access(user);
    if (input.id !== 'all' && (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id))) throw problem(400, 'INVALID_DATA');
    db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND (?=\'all\' OR id=?)').run(now(), user.id, input.id, input.id);
    return {ok: true};
  }
  function device(input, user, sessionHash) {
    access(user);
    if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw problem(400, 'INVALID_DATA');
    const subscribed = !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? AND endpoint=? AND public_key=?').get(user.id, input.endpoint, transport.publicKey || '');
    if (subscribed && sessionHash) db.prepare('UPDATE push_subscriptions SET session_hash=? WHERE user_id=? AND endpoint=?').run(sessionHash, user.id, input.endpoint);
    return {subscribed};
  }
  function subscribe(input, user, sessionHash) {
    access(user);
    if (!transport.publicKey) throw problem(503, 'PUSH_NOT_CONFIGURED');
    if (!Object.keys(types).some(type => enabled(user, type))) throw problem(403, 'FORBIDDEN');
    const {endpoint} = validateSubscription(input);
    const existing = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint=?').get(endpoint);
    if (existing && existing.user_id !== user.id) throw problem(409, 'SUBSCRIPTION_IN_USE');
    if (!existing && db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?').get(user.id).n >= 10) throw problem(429, 'SUBSCRIPTION_LIMIT');
    db.prepare('INSERT INTO push_subscriptions(id,user_id,session_hash,endpoint,public_key,at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET session_hash=excluded.session_hash,public_key=excluded.public_key,at=excluded.at').run(randomUUID(), user.id, sessionHash, endpoint, transport.publicKey, now());
    return {ok: true};
  }
  function unsubscribe(input, user) {
    access(user);
    if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw problem(400, 'INVALID_DATA');
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(user.id, input.endpoint);
    return {ok: true};
  }
  const testCooldown = new Map();
  async function testDevice(input, user) {
    access(user);
    if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw problem(400, 'INVALID_DATA');
    if (!transport.send) throw problem(503, 'PUSH_NOT_CONFIGURED');
    if (!Object.keys(types).some(type => enabled(user, type))) throw problem(403, 'FORBIDDEN');
    const current = db.prepare('SELECT id,endpoint FROM push_subscriptions WHERE user_id=? AND endpoint=? AND public_key=?').get(user.id, input.endpoint, transport.publicKey);
    if (!current) throw problem(410, 'DEVICE_NOT_SUBSCRIBED');
    for (const [id, until] of testCooldown) if (until <= now()) testCooldown.delete(id);
    if (testCooldown.has(current.id)) throw problem(429, 'RATE_LIMITED');
    testCooldown.set(current.id, now() + 30000);
    let status = 0;
    try { status = await transport.send(current.endpoint); } catch {}
    if (status === 404 || status === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(current.id);
      throw problem(410, 'DEVICE_NOT_SUBSCRIBED');
    }
    if (status < 200 || status >= 300) throw problem(502, 'PUSH_DELIVERY_FAILED');
    return {ok: true};
  }
  function systemStatus(status) {
    const values = {systemDatabase: status.database?.state, systemDisk: status.disk?.state,
      systemBackup: [status.backups?.state, status.secondary?.state, status.manual?.state].includes('failed') ? 'failed' : [status.backups?.state, status.secondary?.state].includes('warning') ? 'warning' : status.backups?.state === 'ok' && status.secondary?.state === 'ok' ? 'ok' : 'unknown', systemUpdate: status.updates?.state};
    store.transaction(() => {
      for (const [type, value] of Object.entries(values)) {
        if (!['ok', 'warning', 'failed', 'unknown'].includes(value)) continue;
        const old = state(type);
        if (old !== value) {
          const generation = Number(state(type + ':generation') || 0) + 1;
          saveState(type + ':generation', generation);
          if (value !== 'ok') emit(type, type + ':' + generation, users());
          saveState(type, value);
        }
      }
      if (status.state === 'ok' && state('system') && state('system') !== 'ok') {
        const generation = Number(state('system:generation') || 0) + 1; saveState('system:generation', generation);
        emit('systemRecovery', 'recovery:' + generation, users());
      }
      saveState('system', status.state);
    });
  }
  let working = false, stopped = false, running;
  async function deliver() {
    if (working || stopped || !transport.send) return;
    working = true;
    try {
      for (const job of db.prepare('SELECT q.*,s.endpoint,s.user_id,s.public_key FROM push_queue q JOIN push_subscriptions s ON s.id=q.subscription_id WHERE q.next_at<=? LIMIT 20').all(now())) {
        if (stopped) break;
        // Re-read the account and subscription immediately before sending each job.
        const row = db.prepare('SELECT * FROM users WHERE id=? AND active=1 AND deleted_at IS NULL').get(job.user_id);
        if (!db.prepare('SELECT 1 FROM push_subscriptions WHERE id=?').get(job.subscription_id)) continue;
        if (!row || job.public_key !== transport.publicKey || !can(userFrom(row), 'canViewNotifications')) { db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(job.subscription_id); continue; }
        const user = userFrom(row);
        const pending = db.prepare('SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL').all(user.id).some(item => enabled(user, item.type) && visible(item, user));
        if (!pending) { db.prepare('DELETE FROM push_queue WHERE subscription_id=? AND generation=?').run(job.subscription_id, job.generation); continue; }
        let status = 0;
        try { status = await transport.send(job.endpoint); } catch { /* Never log subscription URLs or configuration. */ }
        if (stopped) break;
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(job.subscription_id);
        else if (status >= 200 && status < 300 || job.attempts >= 7) db.prepare('DELETE FROM push_queue WHERE subscription_id=? AND generation=?').run(job.subscription_id, job.generation);
        else db.prepare('UPDATE push_queue SET attempts=attempts+1,next_at=? WHERE subscription_id=?').run(now() + Math.min(3600000, 30000 * 2 ** job.attempts), job.subscription_id);
      }
    } finally { working = false; }
  }
  function flush() { if (!working && !stopped) running = deliver(); return running; }
  async function close() { stopped = true; await running; }
  return {sync, prune, list, summary, preferences, updatePreferences, read, device, subscribe, unsubscribe, testDevice, systemStatus, flush, close};
}
module.exports = {createNotifications};
