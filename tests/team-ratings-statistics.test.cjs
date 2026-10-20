/* Fictional people only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/team-ratings-statistics-model.js');
const row = (id, team, good, ok, poor, extra = {}) => ({id, name: 'Demo ' + id, team, good, ok, poor, total: good + ok + poor, lowData: good + ok + poor < 5, pairs: 2, achieved: 1, present: 2, absent: 1, ...extra});
const summary = {rows: [row('a', 'А', 4, 1, 0), row('b', 'А', 0, 1, 1), row('c', 'Б', 1, 0, 1), row('d', 'Б', 0, 0, 0)], reasons: [{team: 'А', reason: 'slow', count: 2}, {team: 'Б', reason: 'slow', count: 1}, {team: 'Б', reason: 'scrap', count: 1}]};
test('totals keep ratings, pair results and attendance as separate figures', () => {
  const all = model.aggregate(summary);
  assert.deepEqual([all.total, all.good, all.poor, all.people, all.rated, all.pairs, all.achieved, all.absent], [9, 5, 2, 4, 3, 8, 4, 4]);
  assert.equal(Math.round(all.goodPct), 56); assert.equal(all.achievedPct, 50);
  assert.deepEqual(all.teams.map(group => [group.team, group.total, group.people]), [['А', 7, 2], ['Б', 2, 2]]);
});
test('rankings use the share, then more ratings; people without that rating are left out', () => {
  const {rankings} = model.aggregate(summary);
  assert.deepEqual(rankings.best.map(item => item.id), ['a', 'c']);
  assert.deepEqual(rankings.worst.map(item => item.id), ['b', 'c'], 'b and c are both 50 % poor; b has the same count, then name');
});
test('the team filter narrows people and reasons; empty input stays empty', () => {
  const team = model.aggregate(summary, 'Б');
  assert.deepEqual([team.total, team.people, team.reasonTotal], [2, 2, 2]);
  assert.deepEqual(team.reasons.map(reason => [reason.key, reason.count, reason.pct]), [['slow', 1, 50], ['scrap', 1, 50]]);
  const empty = model.aggregate({rows: [], reasons: []});
  assert.deepEqual([empty.total, empty.goodPct, empty.teams, empty.rankings.best], [0, null, [], []]);
});
