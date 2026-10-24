/* Read-only projections. Cache only the latest document revision in server memory. */
const {problem} = require('./store.cjs');
const shifts = ['А','Б','В','Г','СТИКЕРИ'];
function createStatisticsReads(store) {
  const cache = new Map();
  const revision = store.db.prepare('SELECT revision FROM documents WHERE kind=?');
  const decisions = store.db.prepare('SELECT (SELECT count(*)||\'/\'||ifnull(max(at),0) FROM production_shift_authorizations)||\'/\'||(SELECT count(*) FROM production_pending_shifts) state');
  // Stickers rest-day reports stay out of statistics until an administrator approves the date.
  const approved = (kind, data) => kind === 'line-downtime' ? data : {...data, entries: data.entries.filter(entry => (entry.shift ?? entry.team) !== 'СТИКЕРИ' || !store.productionAccess.awaiting(entry.date))};
  function document(kind) { const value = store.get(kind); return {...value, data: approved(kind, value.data)}; }
  function snapshot(kind) {
    const current = revision.get(kind);
    if (!current) throw problem(404,'NOT_FOUND');
    const decided = decisions.get(), key = current.revision + '/' + decided.state;
    if (cache.get(kind)?.key === key) return cache.get(kind);
    const data = approved(kind, store.get(kind).data), months = new Map(), years = new Map(), byMonth = new Map(), byYear = new Map();
    for (const entry of data.entries) for (const [rows,key] of [[byMonth,entry.date.slice(0,7)],[byYear,entry.date.slice(0,4)]]) {
      if (!rows.has(key)) rows.set(key,[]);
      rows.get(key).push(entry);
    }
    const availableYears = [...new Set(data.entries.map(entry => entry.date.slice(0,4)))].sort();
    const empty = key => kind === 'production-log' ? {key,tonnage:0,brak:0,count:0,byShift:Object.fromEntries(shifts.map(shift => [shift,0]))} : {key,durationMin:0,count:0};
    if (kind !== 'pair-targets') for (const entry of data.entries) {
      for (const [rows,key] of [[months,entry.date.slice(0,7)],[years,entry.date.slice(0,4)]]) {
        if (!rows.has(key)) rows.set(key,empty(key));
        const row = rows.get(key);
        row.count++;
        if (kind === 'production-log') {
          const tonnage = Number(entry.tonnage) || 0;
          row.tonnage += tonnage; row.brak += Number(entry.brak) || 0;
          if (Object.hasOwn(row.byShift,entry.shift)) row.byShift[entry.shift] += tonnage;
        } else row.durationMin += Number(entry.durationMin) || 0;
      }
    }
    const result = {key,revision:current.revision,data,byMonth,byYear,summary:{availableYears,
      months:[...months.values()].sort((a,b) => a.key.localeCompare(b.key)),
      years:[...years.values()].sort((a,b) => a.key.localeCompare(b.key))}};
    cache.set(kind,result); return result;
  }
  function read(kind, month, scope = 'year') {
    if (!['production-log','line-downtime','pair-targets'].includes(kind)) throw problem(404,'NOT_FOUND');
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !['year','all'].includes(scope)) throw problem(400,'INVALID_PERIOD');
    const current = snapshot(kind);
    const entries = kind === 'line-downtime' ? scope === 'all' ? current.data.entries : current.byYear.get(month.slice(0,4)) || [] : current.byMonth.get(month) || [];
    const data = kind === 'production-log' ? {entries,goalTons:current.data.goalTons,summary:current.summary}
      : kind === 'line-downtime' ? {entries,summary:current.summary}
      : {module:current.data.module,schemaVersion:current.data.schemaVersion,entries,availableYears:current.summary.availableYears};
    return {revision:current.revision,data};
  }
  return {read, document};
}
module.exports = {createStatisticsReads};
