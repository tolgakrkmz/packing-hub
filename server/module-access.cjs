/* Purpose-specific read views avoid granting the complete personnel module. */
const {canViewModule} = require('./permissions.cjs');
function pairRoster(employees) {
  return employees.filter(person => person.active !== false && typeof person.role === 'string' && person.role.trim().toLowerCase() === 'опаковчик')
    .map(({id, name, category, team, role}) => ({id, name, category, team, role, active: true}));
}
function workforceCounts(employees) {
  if (!employees.length) return null;
  const active = employees.filter(person => person.active !== false);
  const counts = {auto: {}, manual: {}, production: {}, autoTotal: 0, manualTotal: 0, productionTotal: 0,
    stickers: active.filter(person => person.category === 'stickers').length,
    additional: employees.length - active.length, totalActive: active.length};
  for (const team of ['А', 'Б', 'В', 'Г']) {
    counts.auto[team] = active.filter(person => person.category === 'auto' && person.team === team).length;
    counts.manual[team] = active.filter(person => person.category === 'manual' && person.team === team).length;
    counts.production[team] = counts.auto[team] + counts.manual[team];
    counts.autoTotal += counts.auto[team]; counts.manualTotal += counts.manual[team];
    counts.productionTotal += counts.production[team];
  }
  return counts;
}
module.exports = {canViewModule, pairRoster, workforceCounts};
