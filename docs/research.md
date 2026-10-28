# TG Bad Waldsee Warriors website: research

Date: 2026-10-20. Everything in part 1 was tested live against the API on that date.
Raw responses are in `docs/api-samples/`.

---

## Part 1: Getting game data from basketball-bund.net

### Verdict

The basketball-bund.net web app (`/static/#/...`) is an AngularJS front end. It loads all its data
from a JSON REST API at `https://www.basketball-bund.net/rest`. That API is the best source:

- No login, no API key, plain `GET`, JSON.
- Same data the official site shows, including per-player box scores.
- **Unofficial and undocumented.** The DBB does not publish or guarantee it. It can change without
  notice. Community docs exist (see below), and they match what I found.

Do not scrape the old JSP pages (`index.jsp?Action=10x`). `robots.txt` disallows them, and the REST
API returns the same data in a cleaner form.

### The IDs you need

| What | ID | Stable? |
|---|---|---|
| Club "TG 1848 Bad Waldsee e.V." | `clubId` **5205** | Yes |
| Team "TG Bad Waldsee" (Senioren I, m) | `teamPermanentId` **319452** | Yes, across seasons |
| League "BBW4 Kreisliga Süd", season 2026/27 | `ligaId` **55024** | **No**, new ID every season |
| Single game | `matchId`, e.g. 2896352 | Yes |

The club has only this one team in the current season.
Use `teamPermanentId` as the entry point. It finds the current league every season, so you never
hard-code `ligaId`.

### Endpoints (all tested)

Base: `https://www.basketball-bund.net/rest`

| Purpose | Endpoint | Notes |
|---|---|---|
| **All games of our team** (past + next) | `GET /team/id/319452/matches` | Best entry point. 14 games this season. Each game carries `ligaData.ligaId`. |
| **League table** | `GET /competition/table/id/{ligaId}` | Use as-is. It includes point deductions (TB Sigmaringen has −1). Do not compute standings yourself. |
| Full league schedule (all teams) | `GET /competition/spielplan/id/{ligaId}` | Also contains `tabelle`, `kreuztabelle`, `teamStatistik`. |
| Current match day | `GET /competition/actual/id/{ligaId}` | |
| Team totals per league | `GET /competition/teamstatistic/id/{ligaId}` | `?perMatch=true` for averages. |
| Cross table | `GET /competition/crosstable/id/{ligaId}` | |
| **Box score of one game** | `GET /match/id/{matchId}/boxscore` | Per-player stats + quarter scores (`matchResult`). |
| Game details | `GET /match/id/{matchId}/matchInfo` | Venue + address, referees, top performers. |
| Club games, next ~30 days | `GET /club/id/5205/actualmatches?justHome=false&rangeDays=30` | `rangeDays` is capped at about 30. |
| Play-by-play | `GET /match/id/{matchId}/playbyplay` | Empty for our league (`hasPlayByPlay: false`). |
| League search | `POST /wam/data`, `POST /wam/liga/list?startAtIndex=0` | Only needed to discover leagues. Not needed for us. |

Every response has the same envelope:

```json
{ "timestamp": "...", "status": "0", "message": "", "data": { ... } }
```

`status` `"0"` means OK. An unknown ID still returns HTTP 200, with `status: "1"` and a message such as
`"no team found with id ..."`. Check `status`, not only the HTTP code.

Quick test:

```sh
curl -s https://www.basketball-bund.net/rest/team/id/319452/matches \
  | jq -r '.data.matches[] | [.kickoffDate, .kickoffTime, .homeTeam.teamname, .guestTeam.teamname, (.result // "-")] | @tsv'
```

### Which stats exist for our league

The Kreisliga games use a scoresheet, not live stat tracking. The box score therefore contains:

| Field | Meaning | Recorded? |
|---|---|---|
| `pts` | Points | Yes |
| `twoPoints.made`, `threePoints.made` | 2P / 3P made | Yes (attempts are always 0) |
| `onePoints.made` / `.attempted` / `.quota` | Free throws made / attempted / % | Yes |
| `wt.made` | Field goals made (2P + 3P) | Yes |
| `fouls` | Personal fouls | Yes |
| `eff` | Efficiency, computed by DBB | Yes |
| `ro`, `rd`, `rt`, `as`, `st`, `to`, `bs` | Rebounds, assists, steals, turnovers, blocks | **No, always 0** |
| `esz` | Minutes played | **No, always 0** |
| `player.no` | Jersey number | **No, always "0"** |

There is **no season player stats endpoint**. Season stats (games played, PPG, 3PM, FT%, fouls) must be
summed from the box scores of each game. That is cheap: at most 14 box scores per season.

Example, game 1 (TG Bad Waldsee vs TV Konstanz 3, 81:84 OT): top scorers with 21 pts (10× 2P, 1/3 FT),
19 pts (3× 2P, 4× 3P) and 17 pts. (The samples in `docs/api-samples` have the real names replaced by placeholders.)

### Pitfalls found in the data

1. **Anonymised players.** A player can opt out of publication on the DBB. They then appear as
   `"*** ****"`, `no: "**"`, `anonym: true`, `playerId: 0`. One TG player in game 1 is anonymised.
   The site must keep that player anonymous unless they agree otherwise.
2. **Unconfirmed results.** `result` is filled before the league confirms it
   (`ergebnisbestaetigt: false`, e.g. game 2 at TB Sigmaringen 46:57). Show it as "vorläufig".
3. **Quarter scores are per quarter, not cumulative.** In `matchResult`, `heimHalbzeitstand` is the
   score of quarter 2 only, not the halftime total. Game 1: 22 + 16 + 14 + 18 + 11 (OT) = 81.
4. **Booleans can be `null`.** `abgesagt`, `verzicht`, `ergebnisbestaetigt`, `anonym` can be `true`,
   `false` or `null`. Compare with `=== true`.
5. **Date and time are separate strings** (`"2026-10-10"`, `"15:00"`, local German time). There is no
   ISO timestamp.
6. **Old seasons disappear.** The API stops serving past seasons after some time (reported by the
   bbb-ics-generator project). Keep your own JSON snapshot per season if you want history.
7. **No CORS header.** Browsers block calls from your own domain. Fetch on the server side (at build
   time). That also means visitors never connect to a third party.

### Recommended fetch strategy

1. `GET /team/id/319452/matches` gives all games and the current `ligaId`.
2. `GET /competition/table/id/{ligaId}` gives the table.
3. For each game with a `result` that is not yet cached as confirmed: `GET /match/id/{id}/boxscore` and
   `GET /match/id/{id}/matchInfo`. Once `ergebnisbestaetigt` is `true`, the game never changes. Cache
   it permanently.
4. Write everything to `data/<season>/...json`. If a fetch fails or `status != "0"`, keep the last good
   files and do not deploy broken data.

Frequency: the API sits behind a Varnish cache with `max-age=120`. Fetching once per hour is plenty and
costs about 3 requests per run. Send a `User-Agent` with a contact address, so the DBB can reach you
instead of blocking you.

### Legal note on the data

The data belongs to the DBB and the regional association (BBW). The API is public but unofficial, with
no published terms. Low-frequency use for a club website is what several existing projects do. To be
safe, ask the BBW or the DBB for an OK.

Player names come from the DBB, but showing them on your own site is your own processing under GDPR.
See part 2, "Legal".

### Community projects (reuse their knowledge, not necessarily their code)

- [OliEder/basketball-bund-api](https://github.com/OliEder/basketball-bund-api): reverse-engineered
  API docs, OpenAPI spec, real sample responses, a contract-check CI job. Matches my findings.
  [Swagger UI](https://olieder.github.io/basketball-bund-api/).
- [OliEder/bbb-ics-generator](https://github.com/OliEder/bbb-ics-generator): a club portal that fetches
  the API every 6 h and builds a static site with schedules, tables and ICS calendar feeds. Closest
  to what you want. Good reference for the season archive and ICS feeds.
- [OliEder/bbb-sportspress-sync](https://github.com/OliEder/bbb-sportspress-sync): syncs the API into
  WordPress SportsPress.
- [dirkdrutschmann/basketball-bund-sdk](https://github.com/dirkdrutschmann/basketball-bund-sdk):
  TypeScript SDK. Small, installs only from git. Plain `fetch` is enough for 4 endpoints.

---

## Part 2: Building the website

> **Superseded (2026-10-20):** a CMS with a database was chosen. See `docs/architecture.md`.
> The pages, legal notes, hosting facts and colours below still apply.

### Recommendation

**A static site built with Astro, rebuilt every hour from fresh API data, served from a container on
the DS923+.**

Why static:

- The data changes a few times per week. A static site is fast and has almost no attack surface on
  your home network: no database, no PHP, no admin login exposed to the internet.
- Box scores and the table are fetched at build time, so the browser needs no API calls.

Why Astro (current: 7.4.1):

- **Content collections**: players and news are Markdown files with a validated schema. Adding a player
  means adding one file and one photo.
- **Built-in image optimisation**: player photos are resized and converted to WebP/AVIF automatically.
- Ships no JavaScript unless a page needs it.
- The build can read the fetched JSON directly.

Alternatives considered:

| Option | Why not (for now) |
|---|---|
| WordPress + SportsPress (+ bbb-sportspress-sync) | Easiest for non-technical editors. But PHP + MariaDB on your NAS, exposed to the internet, needs constant patching. |
| Hugo | Fine and fast. Templating and data handling are clumsier for computed stats. |
| Next.js / server app | Needs a running Node server. No benefit for this data. |

### Architecture

```
          every hour (container on NAS)
DBB REST API ──► fetch script ──► data/2026/*.json  (snapshots, last good kept)
                                        │
src/content/players/*.md  ──────────────┤
src/content/news/*.md     ──────────────┤
src/assets/players/*.jpg  ──────────────┘
                                        ▼
                                  astro build ──► dist/ (static HTML)
                                                     │
                                         nginx container (read-only)
                                                     │
                                 Cloudflare Tunnel  or  DSM reverse proxy
                                                     │
                                                 Internet
```

### Content model

**Player** (`src/content/players/max-mustermann.md`):

```yaml
---
name: Max Mustermann
number: 7            # the API has no jersey numbers
position: Forward
photo: ../../assets/players/max-mustermann.jpg
dbbPersonId: 100001  # links to box score data (player.person.id)
since: 2024
consent: true        # written consent for name + photo on file
---
Short bio ...
```

`dbbPersonId` is the join key. It matches `player.person.id` in the box score. With it, the player page
shows season stats and a game log automatically. A player without a Markdown file still appears in the
stats under the name from the API, unless they are anonymised.

**News** (`src/content/news/2026-10-18-sieg-in-sigmaringen.md`): title, date, cover image, Markdown body.
Optional link to a `matchId`, so the post can show the box score.

### Pages

- **Home**: next game (date, venue, map link), last result, league table, latest news.
- **Spielplan**: all games, home/away filter, results, link to each game.
- **Spiel**: quarter scores, box score, venue, top scorers.
- **Tabelle**: league table with our row highlighted.
- **Team / Kader**: player cards with photo.
- **Spieler**: bio + season stats (GP, PTS, PPG, 2PM, 3PM, FT%, fouls, EFF) + game log.
- **News**: list and article pages.
- **Impressum, Datenschutz**: required (see "Legal").
- Cheap extra: an ICS calendar feed of all games, so fans can subscribe on their phones.

### Hosting on your DS923+

Checked over SSH: DS923+, DSM 7.4.1, x86_64, 4 cores, 4 GB RAM. Container Manager and Web Station are
already installed.

Run one Container Manager project (docker compose) with:

- `web`: `nginx:alpine`, serves `dist/` read-only.
- `builder`: `node:24-alpine` (current LTS). Runs fetch + `astro build` every hour, writes to `dist/`.
- `tunnel` (only for option A below): `cloudflare/cloudflared`.

Do not use the Synology "Node.js v20" package. Node 20 reached end of life in April 2026.

### Making it reachable from the internet

**Security warning:** never forward DSM ports (5000/5001) or SSH (22) on the FRITZ!Box. Only the website
should be reachable from outside.

**Option A: Cloudflare Tunnel (recommended).** The `cloudflared` container opens an outgoing
connection to Cloudflare, and Cloudflare serves the site.
- No port forwarding. Your home IP stays hidden. TLS is free and automatic.
- Works even without a public IPv4 address. Many German connections on a FRITZ!Box use DS-Lite and
  have none.
- Needs a domain whose DNS is on Cloudflare (about 10 €/year, e.g. `bad-waldsee-warriors.de`).
  The free Cloudflare plan is enough.

**Option B: FRITZ!Box port forward 443 → DSM reverse proxy.** Use DSM Login Portal → Advanced →
Reverse Proxy, plus a Let's Encrypt certificate from DSM.
- No third party involved.
- Needs a public IPv4 (or IPv6-only visitors). It exposes your home IP. Every DSM security update
  matters.

### Legal (Germany)

- **Impressum** (§ 5 DDG) and **Datenschutzerklärung** are required for a public club website.
  Decide whether you or the TG 1848 Bad Waldsee e.V. operates the site. The operator goes in the
  Impressum.
- **Player names, stats and photos**: get written consent from each player (GDPR Art. 6(1)(a); photos
  also under KUG § 22). Players who are anonymised on the DBB stay anonymous.
- **Fonts**: self-host them. Do not load Google Fonts from Google's servers (LG München I, 2022).
- **No tracking and no cookies.** Then no cookie banner is needed.

### Colours from the logo

Taken from `~/Downloads/tg_baskteball_logo_large (1).svg` (the 1000 px PNG
`tg_basketball_logo.png` is the same design). The logo sits on black, so a **dark theme** fits best.

| Role | Colour | Source in logo |
|---|---|---|
| Background | `#0b0707` | Black background |
| Surface (cards) | `#191715` / `#312e29` | Dark greys |
| Primary | `#f47f0d` | Basketball orange |
| Primary dark | `#e1590b` / `#b13106` | Ball shading |
| Accent | `#6ca60c` | "WARRIORS" green, TG mark |
| Accent dark | `#418705` | Green shading |
| Highlight | `#dfe336` | Lightning yellow-lime |
| Text | `#f5f4f0` | Off-white |

Contrast (WCAG): orange `#f47f0d` on black ≈ 7.4:1 and green `#6ca60c` on black ≈ 6.7:1, both fine
for text. On white, both fail (≈ 2.7:1 and 3.0:1). In a light theme, use `#b13106` (≈ 6.3:1) for
orange text.

### Next steps

1. Scaffold the Astro project and the fetch script (the 4 endpoints above, with the season snapshot).
2. Build the pages with the data that already exists (schedule, table, box scores, stats).
3. Add player Markdown files and photos as consents come in.
4. Set up the Container Manager project on the NAS.
5. Get a domain and choose option A or B.

Open decisions:

- Public domain name, and Cloudflare Tunnel (A) or port forwarding (B).
- Who writes news. If teammates without Git should post, add a web editor later (e.g. Keystatic or
  Decap CMS). Start with Markdown files.
- Who is the operator in the Impressum: you or the club.
