// Mirrors the basketball-bund.net API for one team into Postgres, every SYNC_INTERVAL_MINUTES.
// All writes of one run happen in a single transaction: a failed run leaves the last good data untouched.
// Run once and exit: node sync.mjs --once
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { mapTeamMatches, mapTable, mapBoxscore, mapMatchInfo } from './map.mjs';

const API = 'https://www.basketball-bund.net/rest';
const TEAM_ID = Number(process.env.TEAM_ID);
const INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);
const USER_AGENT = process.env.USER_AGENT ?? 'tg-bad-waldsee-warriors-website (+https://warriors.hartwig-bw.de)';
// The website role may read exactly these tables, never directus_users and friends.
const WEB_TABLES = [
  'dbb_leagues', 'dbb_teams', 'dbb_games', 'dbb_standings', 'dbb_persons', 'dbb_player_game_stats',
  'players', 'news', 'pages', 'directus_files',
];

if (!Number.isInteger(TEAM_ID) || TEAM_ID <= 0) throw new Error('TEAM_ID missing');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
process.on('SIGTERM', () => process.exit(0));

async function get(path) {
  const res = await fetch(API + path, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json = await res.json();
  // unknown IDs come back as HTTP 200 with status "1"
  if (json.status !== '0') throw new Error(`${path}: status ${json.status} ${json.message}`);
  await new Promise((r) => setTimeout(r, 250)); // be polite to the DBB
  return { path, data: json.data };
}

async function upsert(client, table, key, rows) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const set = cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`);
    await client.query(
      `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       on conflict (${key}) do update set ${[...set, 'updated_at = now()'].join(', ')}`,
      cols.map((c) => row[c]),
    );
  }
}

async function ensureSchema() {
  await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  if (!process.env.WEB_DB_PASSWORD) throw new Error('WEB_DB_PASSWORD missing');
  const c = await pool.connect();
  try {
    const exists = (await c.query("select 1 from pg_roles where rolname = 'web'")).rowCount > 0;
    await c.query(`${exists ? 'alter' : 'create'} role web login password ${c.escapeLiteral(process.env.WEB_DB_PASSWORD)}`);
    // CMS tables appear only after the Directus bootstrap, so grant on whatever exists by now.
    const { rows } = await c.query('select t from unnest($1::text[]) t where to_regclass(t) is not null', [WEB_TABLES]);
    if (rows.length) await c.query(`grant select on ${rows.map((r) => c.escapeIdentifier(r.t)).join(', ')} to web`);
  } finally {
    c.release();
  }
}

async function runOnce() {
  const raw = [];
  const fetchRaw = async (path) => {
    const r = await get(path);
    raw.push(r);
    return r.data;
  };

  const { leagues, teams, games } = mapTeamMatches(await fetchRaw(`/team/id/${TEAM_ID}/matches`));
  const tables = [];
  for (const l of leagues) tables.push(mapTable(await fetchRaw(`/competition/table/id/${l.liga_id}`)));

  const known = new Map(
    (await pool.query('select match_id, confirmed, boxscore_at, venue_name from dbb_games')).rows.map((r) => [r.match_id, r]),
  );
  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const boxscores = [];
  for (const g of games) {
    const db = known.get(g.match_id);
    // a box score never changes once the result is confirmed and stored
    if (g.home_score !== null && !(db?.confirmed && db?.boxscore_at)) {
      const box = mapBoxscore(await fetchRaw(`/match/id/${g.match_id}/boxscore`), TEAM_ID);
      Object.assign(g, { quarters: JSON.stringify(box.quarters), boxscore_at: new Date() });
      boxscores.push(box);
    }
    // venues can still change for upcoming games
    if (!db?.venue_name || (g.home_score === null && g.kickoff_date <= soon)) {
      Object.assign(g, mapMatchInfo(await fetchRaw(`/match/id/${g.match_id}/matchInfo`)));
    }
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const r of raw) {
      const sha256 = createHash('sha256').update(JSON.stringify(r.data)).digest('hex');
      await client.query(
        'insert into dbb_raw (endpoint, sha256, payload) values ($1, $2, $3) on conflict (endpoint, sha256) do nothing',
        [r.path, sha256, r.data],
      );
    }
    await upsert(client, 'dbb_leagues', 'liga_id', [...leagues, ...tables.map((t) => t.league)]);
    await upsert(client, 'dbb_teams', 'team_permanent_id', [...teams, ...tables.flatMap((t) => t.teams)]);
    await upsert(client, 'dbb_games', 'match_id', games);
    await upsert(client, 'dbb_standings', 'id', tables.flatMap((t) => t.standings));
    for (const box of boxscores) {
      await upsert(client, 'dbb_persons', 'person_id', box.persons);
      if (box.lines.length) await client.query('delete from dbb_player_game_stats where match_id = $1', [box.lines[0].match_id]);
      await upsert(client, 'dbb_player_game_stats', 'id', box.lines);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { requests: raw.length, games: games.length, boxscores: boxscores.length };
}

const once = process.argv.includes('--once');
for (;;) {
  try {
    await ensureSchema();
    console.log(new Date().toISOString(), 'sync ok', JSON.stringify(await runOnce()));
  } catch (e) {
    console.error(new Date().toISOString(), 'sync failed, last good data kept:', e.message);
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, INTERVAL_MINUTES * 60_000));
}
await pool.end();
