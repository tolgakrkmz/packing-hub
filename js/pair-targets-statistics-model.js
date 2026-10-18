/* Pair reports are independent of production totals. All ratios use reported plans. */
const PairTargetsStatistics = (() => {
  const ratio = (actual, target) => target > 0 ? actual / target * 100 : null;
  function summarize(entries) {
    const totals = {
      planned: 0, cancelled: 0, reported: 0, pending: 0, achieved: 0, missed: 0,
      plannedKg: 0, plannedCrates: 0, reportedTargetKg: 0, reportedTargetCrates: 0,
      actualKg: 0, actualCrates: 0, deficitKg: 0, deficitCrates: 0
    };
    for (const entry of entries) {
      if(entry.cancellation) { totals.cancelled++; continue; }
      totals.planned++;
      totals.plannedKg += entry.targetKg;
      totals.plannedCrates += entry.targetCrates;
      const state = PairTargets.status(entry);
      totals[state]++;
      if (state === 'pending') continue;
      totals.reported++;
      totals.reportedTargetKg += entry.targetKg;
      totals.reportedTargetCrates += entry.targetCrates;
      totals.actualKg += entry.result.kg;
      totals.actualCrates += entry.result.crates;
      totals.deficitKg += Math.max(0, entry.targetKg - entry.result.kg);
      totals.deficitCrates += Math.max(0, entry.targetCrates - entry.result.crates);
    }
    return {...totals,
      successPct: ratio(totals.achieved, totals.reported),
      kgPct: ratio(totals.actualKg, totals.reportedTargetKg),
      cratesPct: ratio(totals.actualCrates, totals.reportedTargetCrates),
      averageKg: totals.reported ? totals.actualKg / totals.reported : null
    };
  }
  function aggregate(entries, month, team = '') {
    const selected = entries.filter(entry => entry.date.slice(0, 7) === month && (!team || entry.team === team));
    const teams = PairTargets.TEAMS.map(name => {
      const records = selected.filter(entry => entry.team === name);
      return {team: name, entries: records, ...summarize(records)};
    }).filter(group => group.planned || group.cancelled);
    const reasons = PairTargets.REASONS.map(reason => {
      const records = selected.filter(entry => PairTargets.status(entry) === 'missed' &&
        (PairTargets.REASONS.some(item => item.key === entry.result.reasonKey) ? entry.result.reasonKey : 'other') === reason.key);
      return {...reason, entries: records, count: records.length};
    }).filter(group => group.count).sort((a, b) => b.count - a.count);
    return {entries: selected, teams, reasons, rankings: rankings(selected), ...summarize(selected)};
  }
  // Top 5 lists for analysis: worst first by success rate, then by tonnage execution.
  function rankings(entries, limit = 5) {
    const groups = new Map(), people = new Map();
    const add = (map, key, name, entry) => { if (!map.has(key)) map.set(key, {key, name, entries: []}); map.get(key).entries.push(entry); };
    for (const entry of entries) {
      if (entry.cancellation || PairTargets.status(entry) === 'pending') continue;
      const members = entry.members.slice().sort((a, b) => a.id.localeCompare(b.id));
      add(groups, members.map(person => person.id).join('+'), members.map(person => person.name).join(' + '), entry);
      for (const person of entry.members) add(people, person.id, person.name, entry);
    }
    const rows = map => Array.from(map.values(), group => ({...group, ...summarize(group.entries)}));
    const worse = (a, b) => a.successPct - b.successPct || a.kgPct - b.kgPct || b.reported - a.reported || a.name.localeCompare(b.name);
    const worst = map => rows(map).filter(row => row.missed).sort(worse).slice(0, limit);
    // Nobody is listed as both worst and best when there are few pairs or people.
    const best = (map, worstRows) => rows(map).filter(row => row.achieved && !worstRows.some(item => item.key === row.key))
      .sort((a, b) => b.successPct - a.successPct || b.kgPct - a.kgPct || b.reported - a.reported || a.name.localeCompare(b.name)).slice(0, limit);
    const worstPairs = worst(groups), worstPeople = worst(people);
    return {worstPairs, bestPairs: best(groups, worstPairs), worstPeople, bestPeople: best(people, worstPeople)};
  }
  return {summarize, aggregate, rankings};
})();
