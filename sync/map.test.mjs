// Run: node --test sync/map.test.mjs   (uses the real API responses saved in docs/api-samples)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResult, mapTeamMatches, mapTable, mapBoxscore, mapMatchInfo } from './map.mjs';

const sample = (f) => JSON.parse(readFileSync(new URL(`../docs/api-samples/${f}`, import.meta.url))).data;
const TEAM = 319452;

test('parseResult', () => {
  assert.deepEqual(parseResult('81:84'), [81, 84]);
  assert.equal(parseResult(null), null);
  assert.equal(parseResult('-'), null);
});

test('team matches: games, unconfirmed results, leagues', () => {
  const { games, leagues, teams } = mapTeamMatches(sample('team_319452_matches.json'));
  assert.equal(games.length, 14);
  const g1 = games.find((g) => g.match_id === 2896352);
  assert.equal(g1.home_score, 81);
  assert.equal(g1.guest_score, 84);
  assert.equal(g1.confirmed, true);
  const g2 = games.find((g) => g.match_id === 2896358);
  assert.equal(g2.guest_score, 57);
  assert.equal(g2.confirmed, false);
  assert.equal(games.find((g) => g.match_id === 2896360).home_score, null);
  assert.deepEqual(leagues.map((l) => l.liga_id), [55024]);
  assert.ok(teams.some((t) => t.team_permanent_id === TEAM));
});

test('table keeps point deductions', () => {
  const { standings } = mapTable(sample('competition_table_55024.json'));
  assert.equal(standings.length, 8);
  assert.equal(standings.find((s) => s.rank === 8).points, -1);
});

test('box score: quarters per period, names only for our team', () => {
  const { quarters, lines, persons } = mapBoxscore(sample('match_2896352_boxscore.json'), TEAM);
  assert.deepEqual(quarters, [[22, 17], [16, 19], [14, 11], [18, 23], [11, 14]]);
  const ours = lines.filter((l) => l.team_permanent_id === TEAM);
  assert.equal(ours.reduce((s, l) => s + l.points, 0), 81);
  // one TG player is anonymised in the DBB data
  assert.equal(ours.filter((l) => l.person_id === null).length, 1);
  assert.equal(persons.length, 9);
  assert.ok(lines.filter((l) => l.team_permanent_id !== TEAM).every((l) => l.person_id === null));
  const top = ours.find((l) => l.points === 21);
  assert.deepEqual([top.fg2_made, top.ft_made, top.ft_attempted], [10, 1, 3]);
});

test('match info venue', () => {
  assert.equal(mapMatchInfo(sample('match_2896352_matchInfo.json')).venue_city, 'Bad Waldsee');
});
