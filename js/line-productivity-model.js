/* Live line split for automatic and manual packing, shared by the browser and the server.
 * Roster line assignments change often, so people come from each shift's pairs (a mixed pair
 * counts half of its people on each line) and tonnage from the shift's auto/manual breakdown.
 * Shifts missing either side are left out. */
const LineProductivity = (() => {
  const TEAMS = ['А','Б','В','Г'], LINES = ['auto','manual'];
  function compute(production, pairs) {
    const people = new Map(), tonnage = new Map();
    (pairs || []).forEach(pair => {
      if (!pair || !pair.date || !TEAMS.includes(pair.team) || pair.cancellation || !pair.areas?.length) return;
      const key = `${pair.date}|${pair.team}`, row = people.get(key) || {auto:0, manual:0};
      pair.areas.forEach(area => { if (area in row) row[area] += pair.members.length / pair.areas.length; });
      people.set(key, row);
    });
    (production || []).forEach(e => {
      if (!e || !e.breakdown || !e.date || !TEAMS.includes(e.shift)) return;
      const key = `${e.date}|${e.shift}`, row = tonnage.get(key) || {auto:0, manual:0};
      row.auto += Number(e.breakdown.autoKg) || 0;
      row.manual += Number(e.breakdown.manKg) || 0;
      tonnage.set(key, row);
    });
    const result = {auto:{kg:0, people:0, shifts:0}, manual:{kg:0, people:0, shifts:0}};
    tonnage.forEach((kg, key) => {
      const row = people.get(key);
      if (!row) return;
      for (const line of LINES) {
        if (!row[line]) continue;
        result[line].kg += kg[line];
        result[line].people += row[line];
        result[line].shifts += 1;
      }
    });
    for (const line of LINES) result[line].tonsPerPerson = result[line].people ? result[line].kg / 1000 / result[line].people : null;
    return result;
  }
  return {compute};
})();
