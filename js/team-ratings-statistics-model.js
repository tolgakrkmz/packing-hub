/* Team ratings dashboard from the server summary. Ratings, pair results and attendance stay separate figures. */
const TeamRatingsStatistics = (() => {
  const REASONS = [{key:'slow', label:'Бавен'}, {key:'scrap', label:'Брак'}, {key:'instructions', label:'Неспазва указания'}, {key:'away', label:'Отсъства от поста'}, {key:'other', label:'Друго'}];
  const share = (part, total) => total > 0 ? part / total * 100 : null;
  function totals(rows) {
    const sum = key => rows.reduce((value, row) => value + row[key], 0);
    const result = {people: rows.length, rated: rows.filter(row => row.total).length, total: sum('total'), good: sum('good'), ok: sum('ok'), poor: sum('poor'),
      pairs: sum('pairs'), achieved: sum('achieved'), present: sum('present'), absent: sum('absent')};
    return {...result, goodPct: share(result.good, result.total), okPct: share(result.ok, result.total), poorPct: share(result.poor, result.total), achievedPct: share(result.achieved, result.pairs)};
  }
  const person = row => ({...row, goodPct: share(row.good, row.total), okPct: share(row.ok, row.total), poorPct: share(row.poor, row.total), achievedPct: share(row.achieved, row.pairs)});
  // Ties go to the person with more ratings, so one rating does not outrank a steady record.
  function rank(rows, key) {
    return rows.filter(row => row[key] > 0).map(person).sort((a, b) => b[key + 'Pct'] - a[key + 'Pct'] || b.total - a.total || a.name.localeCompare(b.name, 'bg')).slice(0, 5);
  }
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
    return {...totals(rows), teams, reasons, reasonTotal, rankings: {worst: rank(rows, 'poor'), best: rank(rows, 'good')}};
  }
  return {REASONS, aggregate};
})();
if (typeof module === 'object' && module.exports) module.exports = TeamRatingsStatistics;
