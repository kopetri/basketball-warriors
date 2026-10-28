// Pure mapping from basketball-bund.net REST responses (the `data` part) to our table rows.
// Field meanings are documented in docs/research.md, part 1.

const int = (v) => (v === null || v === undefined ? null : Math.round(Number(v)));

export function parseResult(result) {
  const m = /^(\d+):(\d+)$/.exec(result ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function league(l) {
  return {
    liga_id: l.ligaId,
    season_id: l.seasonId,
    season_name: l.seasonName,
    name: l.liganame,
    level: l.skName,
  };
}

function team(t) {
  return { team_permanent_id: t.teamPermanentId, name: t.teamname, short_name: t.teamnameSmall, club_id: t.clubId };
}

function uniqueBy(rows, key) {
  return [...new Map(rows.map((r) => [r[key], r])).values()];
}

// GET /team/id/{teamPermanentId}/matches
export function mapTeamMatches(data) {
  if (!Array.isArray(data?.matches)) throw new Error('team matches: data.matches missing');
  const games = data.matches.map((m) => {
    const score = parseResult(m.result);
    return {
      match_id: m.matchId,
      liga_id: m.ligaData.ligaId,
      match_day: m.matchDay,
      match_no: m.matchNo,
      kickoff_date: m.kickoffDate,
      kickoff_time: m.kickoffTime,
      home_team_id: m.homeTeam.teamPermanentId,
      guest_team_id: m.guestTeam.teamPermanentId,
      home_score: score?.[0] ?? null,
      guest_score: score?.[1] ?? null,
      // booleans can be null in the API, see docs/research.md
      confirmed: m.ergebnisbestaetigt === true,
      cancelled: m.abgesagt === true,
      forfeit: m.verzicht === true,
    };
  });
  return {
    leagues: uniqueBy(data.matches.map((m) => league(m.ligaData)), 'liga_id'),
    teams: uniqueBy(data.matches.flatMap((m) => [team(m.homeTeam), team(m.guestTeam)]), 'team_permanent_id'),
    games,
  };
}

// GET /competition/table/id/{ligaId}
export function mapTable(data) {
  if (!data?.ligaData) throw new Error('table: data.ligaData missing');
  const entries = data.tabelle?.entries ?? []; // cups have no table
  if (!Array.isArray(entries)) throw new Error('table: data.tabelle.entries is not a list');
  const ligaId = data.ligaData.ligaId;
  return {
    league: league(data.ligaData),
    teams: entries.map((e) => team(e.team)),
    standings: entries.map((e) => ({
      id: `${ligaId}-${e.team.teamPermanentId}`,
      liga_id: ligaId,
      team_permanent_id: e.team.teamPermanentId,
      rank: e.rang,
      games: e.anzspiele,
      wins: e.s,
      losses: e.n,
      points_for: e.koerbe,
      points_against: e.gegenKoerbe,
      points: e.anzGewinnpunkte,
      minus_points: e.anzVerlustpunkte,
    })),
  };
}

// matchResult holds the score of each period, not running totals (heimHalbzeitstand = quarter 2 only).
function quarters(r) {
  if (!r) return null;
  const periods = [
    [r.heimV1stand, r.gastV1stand],
    [r.heimHalbzeitstand, r.gastHalbzeitstand],
    [r.heimV3stand, r.gastV3stand],
    [r.heimV4stand, r.gastV4stand],
    [r.heimOt1stand, r.gastOt1stand],
    [r.heimOt2stand, r.gastOt2stand],
  ];
  return periods.filter(([h, g]) => h !== null && g !== null);
}

// GET /match/id/{matchId}/boxscore. Names are kept only for our own team (ourTeamId); opponents stay anonymous.
export function mapBoxscore(data, ourTeamId) {
  const box = data?.matchBoxscore;
  const sides = [
    [data.homeTeam.teamPermanentId, box?.homePlayerStats ?? []],
    [data.guestTeam.teamPermanentId, box?.guestPlayerStats ?? []],
  ];
  const persons = [];
  const lines = sides.flatMap(([teamId, stats]) =>
    stats.map((s, i) => {
      const p = s.player?.person;
      const named = teamId === ourTeamId && p && p.anonym !== true && p.id > 0;
      if (named) persons.push({ person_id: p.id, first_name: p.vorname, last_name: p.nachname });
      return {
        id: `${data.matchId}-${teamId}-${i}`,
        match_id: data.matchId,
        team_permanent_id: teamId,
        line: i,
        person_id: named ? p.id : null,
        points: int(s.pts),
        fg2_made: int(s.twoPoints?.made),
        fg3_made: int(s.threePoints?.made),
        ft_made: int(s.onePoints?.made),
        ft_attempted: int(s.onePoints?.attempted),
        fouls: int(s.fouls),
        eff: int(s.eff),
      };
    }),
  );
  return { quarters: quarters(data.matchResult), lines, persons: uniqueBy(persons, 'person_id') };
}

// GET /match/id/{matchId}/matchInfo
export function mapMatchInfo(data) {
  const f = data?.matchInfo?.spielfeld;
  return f
    ? { venue_name: f.bezeichnung, venue_street: f.strasse, venue_zip: f.plz, venue_city: f.ort }
    : { venue_name: null, venue_street: null, venue_zip: null, venue_city: null };
}
