-- Mirror of the basketball-bund.net API. Owned by the sync worker; read-only for editors and the website.
-- Applied on every sync start, so every statement must be idempotent.
-- Surrogate text keys (instead of composite keys) because Directus needs a single primary key.

create table if not exists dbb_raw (
  id bigserial primary key,
  endpoint text not null,
  fetched_at timestamptz not null default now(),
  sha256 text not null,
  payload jsonb not null,
  unique (endpoint, sha256)
);

create table if not exists dbb_leagues (
  liga_id integer primary key,
  season_id integer not null,
  season_name text,
  name text not null,
  level text,
  updated_at timestamptz not null default now()
);

create table if not exists dbb_teams (
  team_permanent_id integer primary key,
  name text not null,
  short_name text,
  club_id integer,
  updated_at timestamptz not null default now()
);

create table if not exists dbb_games (
  match_id integer primary key,
  liga_id integer not null references dbb_leagues,
  match_day integer,
  match_no integer,
  kickoff_date date,
  kickoff_time time,
  home_team_id integer not null references dbb_teams,
  guest_team_id integer not null references dbb_teams,
  home_score integer,
  guest_score integer,
  quarters jsonb,
  confirmed boolean not null default false,
  cancelled boolean not null default false,
  forfeit boolean not null default false,
  venue_name text,
  venue_street text,
  venue_zip text,
  venue_city text,
  boxscore_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists dbb_standings (
  id text primary key,
  liga_id integer not null references dbb_leagues,
  team_permanent_id integer not null references dbb_teams,
  rank integer,
  games integer,
  wins integer,
  losses integer,
  points_for integer,
  points_against integer,
  points integer,
  minus_points integer,
  updated_at timestamptz not null default now()
);

-- Only players of our own team, and never anonymised ones.
create table if not exists dbb_persons (
  person_id integer primary key,
  first_name text,
  last_name text,
  updated_at timestamptz not null default now()
);

create table if not exists dbb_player_game_stats (
  id text primary key,
  match_id integer not null references dbb_games on delete cascade,
  team_permanent_id integer not null references dbb_teams,
  line integer not null,
  person_id integer references dbb_persons,
  points integer,
  fg2_made integer,
  fg3_made integer,
  ft_made integer,
  ft_attempted integer,
  fouls integer,
  eff integer,
  updated_at timestamptz not null default now()
);

create index if not exists dbb_player_game_stats_person on dbb_player_game_stats (person_id);
