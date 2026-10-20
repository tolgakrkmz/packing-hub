/* Team ratings dashboard from the server summary. Ratings and attendance stay separate figures; pair results live in the pair statistics. */
const TeamRatingsStatistics = (() => {
  const REASONS = [{key:'slow', label:'Бавен'}, {key:'scrap', label:'Брак'}, {key:'instructions', label:'Неспазва указания'}, {key:'away', label:'Отсъства от поста'}, {key:'other', label:'Друго'}];
  const share = (part, total) => total > 0 ? part / total * 100 : null;
  function totals(rows) {
    const sum = key => rows.reduce((value, row) => value + row[key], 0);
    const result = {people: rows.length, rated: rows.filter(row => row.total).length, total: sum('total'), good: sum('good'), ok: sum('ok'), poor: sum('poor'),
      present: sum('present'), absent: sum('absent')};
    return {...result, goodPct: share(result.good, result.total), okPct: share(result.ok, result.total), poorPct: share(result.poor, result.total)};
  }
  const person = row => ({...row, goodPct: share(row.good, row.total), okPct: share(row.ok, row.total), poorPct: share(row.poor, row.total)});
  function aggregate(summary, team = '') {
    const rows = summary.rows.filter(row => !team || row.team === team);
    const teams = [...new Set(rows.map(row => row.team))].sort((a, b) => a.localeCompare(b, 'bg')).map(name => {
      const members = rows.filter(row => row.team === name);
      return {team: name, ...totals(members), rows: members.map(person)};
    });
    const counts = new Map();
    for (const item of summary.reasons || []) if (!team || item.team === team) counts.set(item.reason, (counts.get(item.reason) || 0) + item.count);
    const reasonTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const reasons = REASONS.filter(reason => counts.has(reason.key)).map(reason => ({...reason, count: counts.get(reason.key), pct: share(counts.get(reason.key), reasonTotal)})).sort((a, b) => b.count - a.count);
    return {...totals(rows), teams, reasons, reasonTotal};
  }
  return {REASONS, aggregate};
})();
if (typeof module === 'object' && module.exports) module.exports = TeamRatingsStatistics;
