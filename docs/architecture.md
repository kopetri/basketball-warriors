# Architecture decision: CMS, database and containers

Date: 2026-10-20. Status: proposed.
Replaces the "static site only" recommendation in `docs/research.md` part 2.

## Requirements

- Public website for the TG Bad Waldsee Warriors at **`warriors.hartwig-bw.de`**, reached through a
  Cloudflare Tunnel. The zone `hartwig-bw.de` is the operator's own domain, with DNS on Cloudflare.
- Later the club website links or redirects to it from `https://www.tgev.de/wettkampfsport/basketball/`.
- Operator: Sebastian Hartwig (Impressum).
- CMS with a database for news and player data. Teammates can write news without Git.
- All data from the DBB API is mirrored into our own database. The site keeps working and keeps the
  history when the DBB API changes or drops old seasons.
- Runs on the DS923+ (DSM 7.4.1, x86_64, 4 cores, 4 GB RAM, about 1.4 GB free today).

## Decision

**Directus (CMS) on PostgreSQL. A small sync worker mirrors the DBB API into the same database. An
Astro server renders the public site. cloudflared publishes it.** Each of these runs as its own
container in one Container Manager project.

### Why Directus

The key requirement is "the API data lives in our own database". That decides the CMS.

- **Database-first.** Directus puts an admin UI and a REST API on top of ordinary SQL tables. The sync
  worker writes plain tables with plain SQL, and Directus shows them without any CMS code.
  Code-first CMSs (Payload, Strapi) own their schema. An outside writer has to go through their API,
  or it breaks their migrations.
- **Relations across both worlds.** A CMS player record links to the mirrored DBB person
  (`players.dbb_person` → `dbb_persons`). A news post links to a game (`news.game` → `dbb_games`).
- **Roles.** Teammates get an "Editor" role that may write news only. The mirrored DBB tables are
  read-only for everyone except the sync worker.
- **Image handling built in.** Player photos are resized and converted to WebP on request.
- **Aggregation in the API.** Season stats come from `aggregate[sum]` + `groupBy` queries over the box
  score table, so no stats code is needed in the CMS.
- **Licence.** Directus 12 uses MSCL-1.0. Any use is allowed except offering Directus itself as a
  competing service, so a club website is fine. Each release becomes GPL-3.0 after 4 years.

### Alternatives considered

| Option | Verdict |
|---|---|
| **Payload CMS 3** (MIT, Next.js, Postgres) | Strong runner-up. Schema in TypeScript code and the CMS + website in one app, so one container fewer. But the DBB mirror must go through Payload's API. The Next.js build needs about 2 GB RAM, which is tight on the NAS. Pick it if you prefer the schema in code over clicking it in an admin UI. |
| Strapi 5 | Code-first like Payload, without its advantages here. Heavier. |
| PocketBase (single binary, SQLite) | Smallest, at about 30 MB RAM. But only superusers can open its admin UI, so there are no editor roles. Still pre-1.0 (v0.40). |
| WordPress + SportsPress | Has player and league features. But PHP + MariaDB facing the internet, plus plugin patching. The mirror would live in WordPress post-meta tables. |
| Ghost | Good for news. Has no custom data models such as players. |

## Containers

| Service | Container? | Image | Job | RAM (approx.) |
|---|---|---|---|---|
| `db` | **Yes** | `postgres:18-alpine` | Single database for CMS + DBB mirror | 80 MB |
| `cms` | **Yes** | `directus/directus:12.5` | Admin UI, REST API, file and image library | 300 MB |
| `sync` | **Yes**, own small image | `node:24-alpine` | Hourly DBB → Postgres mirror | 60 MB |
| `web` | **Yes**, own image | `node:24-alpine` (Astro, Node adapter) | Public site. Reads Postgres directly through a read-only role; images come through Directus | 80 MB |
| `tunnel` | **Yes**, own project `/volume1/docker/cloudflared` | `cloudflare/cloudflared` | Outgoing tunnel to Cloudflare, shared by the NAS | 30 MB |
| | | | **Total** | **≈ 550 MB** |

Not containers, or not needed at all:

| Component | Decision | Why |
|---|---|---|
| Reverse proxy (nginx, Traefik, Caddy) | **None** | cloudflared routes each hostname straight to a container. |
| Redis / cache | **None** | Directus runs without it. Traffic is small. |
| Web Station | **Not used** | Not needed with containers. |
| Synology "Node.js v20" package | **Not used** | End of life since April 2026. The containers bring Node 24. |
| Existing Postgres on the NAS | **Not reused** | DSM uses its own Postgres internally. A separate container keeps updates and backups independent. |
| Deploys | **`deployer` container**, separate project (added 2026-10-28) | Pulls `main` from GitHub every 5 min with a read-only deploy key. Deploys commits signed by the owner's SSH key or by GitHub's web-flow key (merge button), both listed only on the NAS; `develop` is never deployed. No inbound access and no secrets on GitHub. Accepted risk (owner's decision 2026-10-28): anyone with write access to the repo can deploy by merging, and a deploy runs with Docker (root) rights on the NAS. Chosen over a self-hosted Actions runner (runs any workflow from any branch on the NAS) and over SSH from GitHub-hosted runners (NAS keys stored on GitHub). |
| Backups | **Small `backup` container** (changed 2026-10-20) | `pg_dump` at start and nightly at 03:30 into `data/backups`, keeps 14 days. Lives in the compose file instead of DSM settings. Restore tested. |

### Why sync is its own container (not inside Directus)

- Directus Flows can fetch URLs, but upserting a nested box score with them is clumsy.
- A Directus extension would tie the sync to Directus versions.
- A separate script is easy to test. It writes with `INSERT ... ON CONFLICT DO UPDATE` inside one
  transaction and keeps working while Directus restarts or upgrades.

### Why the site is server-rendered (not static) now

With a CMS, a static build would need a rebuild hook on every news edit. A small Astro server renders
each request from the CMS API instead. News appears immediately, and there is no build pipeline on
the NAS. Traffic for a Kreisliga team is low, so no cache is needed. If that changes, add a Cloudflare
cache rule.

## Network and access

```
Internet
   │
Cloudflare ── warriors.hartwig-bw.de ──────────────────────► web:4321   (public)
   │      └── warriors-cms.hartwig-bw.de ─ Cloudflare Access ─► cms:8055  (email one-time PIN)
   │
tunnel container (outgoing only, no open router ports)
   │
Docker network "warriors" (internal)
   web ──► cms:8055 ──► db:5432 ◄── sync ──► basketball-bund.net
```

Hostnames:

- Use `warriors-cms.hartwig-bw.de`, not `cms.warriors.hartwig-bw.de`. Cloudflare's free Universal SSL
  certificate only covers one subdomain level (`*.hartwig-bw.de`).
- Each public hostname gets an explicit proxied CNAME to the tunnel.

### Tunnel

**One `cloudflared` container runs as its own small project** (`/volume1/docker/cloudflared`, source in
`infra/cloudflared/`). It is the NAS's single tunnel, joins the Docker network `tunnel`, and routes straight to
`web` and `cms`. There is no reverse proxy rule and no published port for the warriors containers, and no port
forward on the router. Other services on the NAS are not part of this project.

- **Cloudflare Access really protects the CMS.** A tunnel has no inbound path that could bypass Access.
- **A separate project, not part of warriors**, so other services can share the tunnel, and stopping the
  warriors project never cuts them off.

Status 2026-10-28: tunnel `nas` is healthy. `warriors.hartwig-bw.de` → `http://warriors-web-1:4321`,
`warriors-cms.hartwig-bw.de` → `http://warriors-cms-1:8055` behind the Access app "Warriors CMS".
Deploys come from GitHub through the `deployer` project. Tested: commits on `develop` are not deployed;
unsigned commits and commits signed with a foreign key are refused; merges with GitHub's merge button deploy.

### Later: link from tgev.de

`www.tgev.de` is a WordPress site with DNS at IONOS (checked 2026-10-20).

- **Simple (recommended):** the club's webmaster adds a 301 redirect from
  `/wettkampfsport/basketball/` to `https://warriors.hartwig-bw.de/` (WordPress plugin "Redirection"),
  or a menu link. Nothing changes on our side.
- **URL under tgev.de** (e.g. `basketball.tgev.de`): a plain CNAME to our hostname does not work
  across Cloudflare accounts. It would need the club to move its DNS to Cloudflare, or Cloudflare for
  SaaS custom hostnames. Decide later, if ever.
- So switching domains later is cheap: the site URL is a single setting (`SITE_URL`) used for
  canonical links, the sitemap and the ICS feed.

- **No ports are published on the NAS.** `db` is only reachable inside the Docker network.
- **The Directus admin is only reachable through Cloudflare Access** (Zero Trust, free up to 50
  users). Only allow-listed email addresses get a one-time PIN, and only then do they see the
  Directus login. Teammates need no VPN.
- **Player photos** are delivered by `web`. It proxies `/media/<id>` to Directus with fixed size
  presets. Directus never faces the internet directly.
- Secrets (database password, Directus key, tunnel token) live in a `.env` file on the NAS, never in Git.

**Security warning:** do not route `cms.<domain>` without the Cloudflare Access policy in front, even
for a quick test. Directus would then be open to password guessing from the whole internet.

## Data model

Tables prefixed with `dbb_` belong to the sync worker. Editors can only read them.

| Table | Content | Key |
|---|---|---|
| `dbb_raw` | Every API response as `jsonb`, with endpoint and fetch time. The full mirror, kept forever. Only stored when the content changed. | `id` |
| `dbb_seasons`, `dbb_leagues` | Season and league metadata | `season_id`, `liga_id` |
| `dbb_teams` | All teams in our leagues | `team_permanent_id` |
| `dbb_games` | Schedule, results, quarter scores, venue, confirmed flag | `match_id` |
| `dbb_standings` | Table rows per league | `liga_id` + `team_permanent_id` |
| `dbb_persons` | Named players from box scores (anonymised players never stored by name) | `person_id` |
| `dbb_player_game_stats` | Box score line per player per game | `match_id` + `row` |

CMS tables, created in Directus:

| Collection | Fields |
|---|---|
| `players` | Name, jersey number, position, photo, bio, `dbb_person` (relation), `consent` (bool), status |
| `news` | Title, slug, date, cover image, body (rich text), `game` (optional relation), status (draft/published) |
| `pages` | Impressum, Datenschutz, "Über uns": editable texts |

Rules:

- The site shows a player's name, photo and stats only if `players.consent = true`. Everyone else
  appears as "Spieler" in box scores. The DBB anonymisation is always respected.
- The Directus schema is exported to Git with `directus schema snapshot`, so the setup can be rebuilt.

## Folder layout (planned)

```
basketball-warriors/
├── compose.yaml          # db, cms, sync, web, tunnel
├── .env.example          # variable names only
├── sync/                 # Node 24 script + schema.sql for dbb_* tables
├── web/                  # Astro site
├── directus/
│   └── snapshot.yaml     # exported CMS schema
└── docs/
```

On the NAS: `/volume1/docker/warriors/` with `postgres/`, `uploads/` and `backups/` as bind mounts.

## Open points

- Allow-list of email addresses for Cloudflare Access (who may edit).
- RAM: about 550 MB needed, about 1.4 GB free. Fine for now. A second RAM module is cheap if you add
  more services later.
