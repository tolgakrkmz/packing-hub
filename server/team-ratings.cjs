/* Quick, optional spot-ratings of the people a shift lead saw on shift. Internal information only, never shown to the people rated. */
const {randomUUID} = require('node:crypto');
const {problem, shiftSchedule} = require('./store.cjs');
const {can} = require('./permissions.cjs');
const RATINGS = ['good', 'ok', 'poor'];
const REASONS = ['slow', 'scrap', 'instructions', 'away', 'other'];
const PROMPT_LIMIT = 3, LOW_DATA = 5, PERIODS = [30, 90];
const scopeKey = entry => entry.date + '/' + entry.shiftCode + '/' + entry.team;
// People in a non-cancelled pair of the shift were present.
function presentPeople(entries, scope) {
  const people = new Map();
  for (const entry of entries) if (!entry.cancellation && scopeKey(entry) === scopeKey(scope)) for (const person of entry.members) people.set(person.id, {id: person.id, name: person.name});
  return [...people.values()];
}
// The longest-unrated people come first (never rated before anyone), so a team is covered in a few weeks.
function selectForPrompt(present, lastRated, limit = PROMPT_LIMIT) {
  return present.slice().sort((a, b) => (lastRated.get(a.id) ?? -1) - (lastRated.get(b.id) ?? -1) || a.name.localeCompare(b.name, 'bg')).slice(0, limit);
}
// Ratings and attendance stay separate columns: absences never change the rating and no reason is recorded.
function summarize({ratings, entries, rosterAt, since}) {
  const rows = new Map();
  const row = (id, name, team) => {
    if (!rows.has(id)) rows.set(id, {id, name, team, good: 0, ok: 0, poor: 0, total: 0, lowData: true, pairs: 0, achieved: 0, present: 0, absent: 0});
    const found = rows.get(id); if (name && !found.name) found.name = name; if (team && !found.team) found.team = team;
    return found;
  };
  const scopes = new Map();
  for (const entry of entries) {
    if (entry.date < since || entry.cancellation) continue;
    const key = scopeKey(entry);
    if (!scopes.has(key)) scopes.set(key, {entry, present: new Set()});
    for (const person of entry.members) {
      scopes.get(key).present.add(person.id);
      if (!entry.result) continue;
      const found = row(person.id, person.name, entry.team); found.pairs++;
      if (entry.result.kg >= entry.targetKg && entry.result.crates >= entry.targetCrates) found.achieved++;
    }
  }
  for (const {entry, present} of scopes.values()) {
    for (const person of rosterAt(entry.team, entry.date)) row(person.id, person.name, entry.team)[present.has(person.id) ? 'present' : 'absent']++;
    for (const id of present) if (!rosterAt(entry.team, entry.date).some(person => person.id === id)) row(id, '', entry.team).present++;
  }
  for (const rating of ratings) {
    if (rating.date < since) continue;
    const found = row(rating.employee_id, rating.name, rating.team); found[rating.rating]++; found.total++;
  }
  for (const found of rows.values()) { found.lowData = found.total < LOW_DATA; if (!found.name) found.name = found.id; }
  return [...rows.values()].sort((a, b) => a.team.localeCompare(b.team, 'bg') || a.name.localeCompare(b.name, 'bg'));
}
function createTeamRatings(store, {now = Date.now} = {}) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS team_ratings(id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, name TEXT NOT NULL, rater_id INTEGER NOT NULL, date TEXT NOT NULL, shift_code INTEGER NOT NULL, team TEXT NOT NULL, rating TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, UNIQUE(employee_id,rater_id,date,shift_code,team));
    CREATE TABLE IF NOT EXISTS team_rating_prompts(rater_id INTEGER NOT NULL, date TEXT NOT NULL, shift_code INTEGER NOT NULL, team TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(rater_id,date,shift_code,team));
    CREATE INDEX IF NOT EXISTS team_ratings_date ON team_ratings(date);`);
  // Rating follows the pair-reporting window and team assignment, so a lead rates only their own team's current shift.
  function scope(input, user) {
    if (!can(user, 'canRateTeam')) throw problem(403, 'FORBIDDEN');
    if (!input || typeof input !== 'object' || typeof input.date !== 'string' || typeof input.team !== 'string' || ![1, 2, 3].includes(input.shiftCode)) throw problem(400, 'INVALID_RATING');
    try { shiftSchedule.parseDate(input.date); } catch { throw problem(400, 'INVALID_RATING'); }
    const access = store.productionAccess.status(input.date, input.team, user, now(), 'pair-targets', input.shiftCode);
    if (!access.allowed) throw problem(403, access.code || 'FORBIDDEN');
    const value = {date: input.date, shiftCode: input.shiftCode, team: input.team};
    return {...value, present: presentPeople(store.get('pair-targets').data.entries, value)};
  }
  // Reserves the shift's single prompt; a second call for the same shift returns nobody.
  function prompt(input, user) {
    const value = scope(input, user);
    return store.transaction(() => {
      const added = db.prepare('INSERT OR IGNORE INTO team_rating_prompts(rater_id,date,shift_code,team,at) VALUES(?,?,?,?,?)').run(user.id, value.date, value.shiftCode, value.team, now()).changes;
      if (!added || !value.present.length) return {people: []};
      const last = new Map(db.prepare('SELECT employee_id,MAX(created_at) AS at FROM team_ratings GROUP BY employee_id').all().map(row => [row.employee_id, row.at]));
      return {people: selectForPrompt(value.present, last)};
    });
  }
  function rate(input, user) {
    const value = scope(input, user);
    if (!Array.isArray(input.ratings) || !input.ratings.length || input.ratings.length > PROMPT_LIMIT || Object.keys(input).some(key => !['date', 'shiftCode', 'team', 'ratings'].includes(key))) throw problem(400, 'INVALID_RATING');
    for (const item of input.ratings) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['employeeId', 'rating', 'reason'].includes(key)) || !RATINGS.includes(item.rating) || item.reason !== undefined && !REASONS.includes(item.reason)) throw problem(400, 'INVALID_RATING');
      if (!value.present.some(person => person.id === item.employeeId)) throw problem(403, 'RATING_NOT_PRESENT');
    }
    return store.transaction(() => {
      // A retried request hits the unique key and keeps the first answer.
      const insert = db.prepare('INSERT OR IGNORE INTO team_ratings(id,employee_id,name,rater_id,date,shift_code,team,rating,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      let saved = 0;
      for (const item of input.ratings) saved += insert.run(randomUUID(), item.employeeId, value.present.find(person => person.id === item.employeeId).name, user.id, value.date, value.shiftCode, value.team, item.rating, item.reason || '', now()).changes;
      if (saved) store.audit(user, 'team-rating', 'pair-targets', {count: saved});
      return {saved};
    });
  }
  function summary(days, user) {
    if (!can(user, 'canViewRatings')) throw problem(403, 'FORBIDDEN');
    if (!PERIODS.includes(days)) throw problem(400, 'INVALID_RATING');
    const since = shiftSchedule.addDays(shiftSchedule.sofiaDate(new Date(now())), -days + 1);
    const employees = store.get('personnel').data.employees;
    const rosters = new Map(), pairs = store.get('pair-targets').data.entries;
    const rosterAt = (team, date) => {
      const key = team + '/' + date;
      if (!rosters.has(key)) rosters.set(key, store.pairRosterAt(employees, team, date));
      return rosters.get(key);
    };
    return {days, since, lowData: LOW_DATA, rows: summarize({ratings: db.prepare('SELECT employee_id,name,team,date,rating FROM team_ratings WHERE date>=?').all(since), entries: pairs, rosterAt, since})};
  }
  return {prompt, rate, summary};
}
module.exports = {createTeamRatings, presentPeople, selectForPrompt, summarize, RATINGS, REASONS, LOW_DATA};
