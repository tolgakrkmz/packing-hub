/* Orders ready for packing that must leave on a truck soon; one manager adds them by hand, shift leads mark them packed or not found. */
const {randomUUID} = require('node:crypto');
const {problem} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const {parse, keyOf} = require('../js/urgent-orders-model.js');
const DAY = 86400000;
function createUrgentOrders(store, {now = Date.now} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS urgent_orders(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);`);
  const requests = store.requestLog('urgent_order_requests', 'INVALID_ORDER', now), idempotent = requests.run;
  const access = user => { if (!can(user, 'canViewUrgentOrders')) throw problem(403, 'FORBIDDEN'); };
  const manager = user => { if (!can(user, 'canManageUrgentOrders')) throw problem(403, 'FORBIDDEN'); };
  const actor = user => ({id: user.id, username: user.username});
  const MARKS = {pack: 'packed', missing: 'missing'};
  function row(id) {
    const found = db.prepare('SELECT * FROM urgent_orders WHERE id=?').get(id);
    if (!found) throw problem(404, 'NOT_FOUND');
    return {...JSON.parse(found.data), id: found.id, revision: found.revision};
  }
  function list(user) {
    access(user);
    return {items: db.prepare('SELECT * FROM urgent_orders').all().map(found => ({...JSON.parse(found.data), id: found.id, revision: found.revision}))};
  }
  // Report rows keep their columns; any other line stays free text. Orders already on the list are skipped, so a re-paste adds only new ones.
  function create(input, user) {
    access(user); manager(user);
    const truckDate = input.truckDate;
    if (typeof input.text !== 'string' || input.text.length > 100000) throw problem(400, 'INVALID_ORDER');
    const lines = input.text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > 300 || lines.some(line => line.trim().length > 300) || typeof truckDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(truckDate) || new Date(Date.parse(truckDate + 'T00:00:00Z') || 0).toISOString().slice(0, 10) !== truckDate) throw problem(400, 'INVALID_ORDER');
    return idempotent(input, user, () => {
      const known = db.prepare('SELECT data FROM urgent_orders').all().map(found => keyOf(JSON.parse(found.data)));
      const {orders, skipped, duplicates} = parse(input.text, known);
      const at = now(), ids = orders.map(order => {
        const id = randomUUID();
        db.prepare('INSERT INTO urgent_orders(id,data) VALUES(?,?)').run(id, JSON.stringify({...order, truckDate, createdAt: at, createdBy: actor(user), status: 'open', markedAt: null, markedBy: null}));
        return id;
      });
      store.audit(user, 'urgent-order-create', 'urgent-orders');
      return {ids, skipped, duplicates};
    });
  }
  function change(id, input, expected, user) {
    access(user);
    const work = () => {
      const item = row(id);
      if (item.revision !== expected) throw problem(409, 'CONFLICT');
      if (input.action === 'remove') {
        manager(user);
        db.prepare('DELETE FROM urgent_orders WHERE id=?').run(id);
        store.audit(user, 'urgent-order-remove', 'urgent-orders');
        return {removed: id};
      }
      if (!MARKS[input.action] && input.action !== 'reopen') throw problem(400, 'INVALID_ORDER');
      if ((item.status === 'open') !== (input.action !== 'reopen')) throw problem(409, 'ORDER_STATE');
      const {id: _, revision, ...data} = item;
      Object.assign(data, MARKS[input.action] ? {status: MARKS[input.action], markedAt: now(), markedBy: actor(user)} : {status: 'open', markedAt: null, markedBy: null});
      db.prepare('UPDATE urgent_orders SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(data), id);
      store.audit(user, 'urgent-order-' + input.action, 'urgent-orders');
      return {item: row(id)};
    };
    if (input.requestId) return idempotent({...input, orderId: id, expected}, user, work);
    return store.transaction(work);
  }
  // Marked orders are kept 30 days so a shift can still check or undo; request ids follow the 90-day window of the other boards.
  function prune() {
    const cutoff = now() - 30 * DAY, remove = db.prepare('DELETE FROM urgent_orders WHERE id=?');
    for (const found of db.prepare('SELECT id,data FROM urgent_orders').all()) { const {markedAt} = JSON.parse(found.data); if (markedAt && markedAt < cutoff) remove.run(found.id); }
    requests.prune(now() - 90 * DAY);
  }
  return {list, create, change, prune};
}
module.exports = {createUrgentOrders};
