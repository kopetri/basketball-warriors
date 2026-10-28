// All website reads. The "web" database role can only SELECT the tables used here.
// Player names and photos are shown only for published players with consent; everyone else stays anonymous.
import { q } from './db';

export const TEAM_ID = Number(process.env.TEAM_ID);

const GAME_SQL = `
  select g.*, l.name as league_name, l.season_id, l.season_name,
         h.name as home_name, a.name as guest_name
  from dbb_games g
  join dbb_leagues l using (liga_id)
  join dbb_teams h on h.team_permanent_id = g.home_team_id
  join dbb_teams a on a.team_permanent_id = g.guest_team_id`;

const CURRENT_SEASON = `(select max(l.season_id) from dbb_games g join dbb_leagues l using (liga_id)
                         where $1 in (g.home_team_id, g.guest_team_id))`;

export function shapeGame(g: any) {
  const home = g.home_team_id === TEAM_ID;
  const played = g.home_score !== null;
  const us = home ? g.home_score : g.guest_score;
  const them = home ? g.guest_score : g.home_score;
  return {
    ...g,
    home,
    played,
    us,
    them,
    won: played && us > them,
    opponent: home ? g.guest_name : g.home_name,
    href: `/spiele/${g.match_id}`,
  };
}
export type Game = ReturnType<typeof shapeGame>;

export async function seasonGames(): Promise<Game[]> {
  const rows = await q(
    `${GAME_SQL} where $1 in (g.home_team_id, g.guest_team_id) and l.season_id = ${CURRENT_SEASON}
     order by g.kickoff_date, g.kickoff_time`,
    [TEAM_ID],
  );
  return rows.map(shapeGame);
}

export async function game(matchId: number): Promise<Game | undefined> {
  const [row] = await q(`${GAME_SQL} where g.match_id = $1 and $2 in (g.home_team_id, g.guest_team_id)`, [matchId, TEAM_ID]);
  return row && shapeGame(row);
}

export async function standings() {
  return q(
    `select s.*, t.name, l.name as league_name
     from dbb_standings s
     join dbb_teams t using (team_permanent_id)
     join dbb_leagues l using (liga_id)
     where l.season_id = ${CURRENT_SEASON}
       and s.liga_id in (select liga_id from dbb_standings where team_permanent_id = $1)
     order by s.liga_id, s.rank`,
    [TEAM_ID],
  );
}

// Our player lines of one game. Opponents only as team totals.
export async function boxScore(matchId: number) {
  const lines = await q(
    `select s.*, p.slug, p.first_name, p.last_name, p.jersey_number
     from dbb_player_game_stats s
     left join players p on p.dbb_person = s.person_id and p.consent and p.status = 'published'
     where s.match_id = $1 and s.team_permanent_id = $2
     order by s.points desc, s.line`,
    [matchId, TEAM_ID],
  );
  const [opponent] = await q(
    `select sum(points)::int as points, sum(fg2_made)::int as fg2_made, sum(fg3_made)::int as fg3_made,
            sum(ft_made)::int as ft_made, sum(ft_attempted)::int as ft_attempted, sum(fouls)::int as fouls
     from dbb_player_game_stats where match_id = $1 and team_permanent_id <> $2`,
    [matchId, TEAM_ID],
  );
  return { lines, opponent };
}

const STATS = `count(s.id)::int as games, coalesce(sum(s.points), 0)::int as points,
  coalesce(sum(s.fg2_made), 0)::int as fg2_made, coalesce(sum(s.fg3_made), 0)::int as fg3_made,
  coalesce(sum(s.ft_made), 0)::int as ft_made, coalesce(sum(s.ft_attempted), 0)::int as ft_attempted,
  coalesce(sum(s.fouls), 0)::int as fouls, coalesce(sum(s.eff), 0)::int as eff`;

const SEASON_LINES = `select s.* from dbb_player_game_stats s
  join dbb_games g using (match_id) join dbb_leagues l using (liga_id)
  where s.team_permanent_id = $1 and l.season_id = ${CURRENT_SEASON}`;

export async function roster() {
  return q(
    `select p.id, p.slug, p.first_name, p.last_name, p.jersey_number, p.position, p.photo, ${STATS}
     from players p
     left join (${SEASON_LINES}) s on s.person_id = p.dbb_person
     where p.status = 'published' and p.consent
     group by p.id
     order by p.sort nulls last, p.last_name`,
    [TEAM_ID],
  );
}

export async function player(slug: string) {
  const [p] = await q(
    `select p.*, ${STATS}
     from players p
     left join (${SEASON_LINES}) s on s.person_id = p.dbb_person
     where p.slug = $2 and p.status = 'published' and p.consent
     group by p.id`,
    [TEAM_ID, slug],
  );
  if (!p) return undefined;
  const log = p.dbb_person
    ? await q(
        `${GAME_SQL} join dbb_player_game_stats s using (match_id)
         where s.person_id = $1 and s.team_permanent_id = $2
         order by g.kickoff_date desc`,
        [p.dbb_person, TEAM_ID],
      )
    : [];
  return { ...p, log: log.map((row) => ({ ...shapeGame(row), line: row })) };
}

export async function newsList(limit = 50) {
  return q(
    `select id, slug, title, summary, cover, date_published from news
     where status = 'published' and date_published <= now()
     order by date_published desc limit $1`,
    [limit],
  );
}

export async function newsPost(slug: string) {
  const [n] = await q(`select * from news where slug = $1 and status = 'published' and date_published <= now()`, [slug]);
  return n;
}

export async function page(slug: string) {
  const [p] = await q(`select title, body from pages where slug = $1`, [slug]);
  return p;
}

// Images are served only when a published page, post or consented player references them.
export async function isPublicFile(id: string) {
  const [r] = await q(
    `select exists (
       select 1 from players where photo = $1::uuid and consent and status = 'published'
       union all select 1 from news where cover = $1::uuid and status = 'published'
       union all select 1 from news where status = 'published' and body like '%' || $1 || '%'
       union all select 1 from pages where body like '%' || $1 || '%'
     ) as ok`,
    [id],
  );
  return r.ok as boolean;
}
