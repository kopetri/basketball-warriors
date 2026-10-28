# TG Bad Waldsee Warriors website

Team website at https://warriors.hartwig-bw.de, with its CMS at https://warriors-cms.hartwig-bw.de (behind Cloudflare Access).
Background and decisions: `docs/research.md` (DBB API) and `docs/architecture.md` (CMS, containers, network).

| Folder | What |
|---|---|
| `sync/` | Mirrors the basketball-bund.net API into Postgres every hour (`dbb_*` tables) |
| `web/` | Astro site, server-rendered from Postgres (read-only role `web`) |
| `cms/bootstrap.mjs` | One-time Directus setup: collections `players`, `news`, `pages`, relations, legal page drafts |
| `infra/cloudflared/` | Shared Cloudflare Tunnel of the NAS (separate project) |
| `infra/deployer/` | Pulls `main` from GitHub every 5 min and deploys signed commits (separate project) |

## Tests

```sh
node --test sync/map.test.mjs
```

## Deploy to the NAS

The NAS runs the stack from `/volume1/docker/warriors`, a Git checkout of `main`. `.env` and `data/` exist only there,
untracked, never in this repo.

**Branches:** work happens on `develop` (never deployed). **Deploying = merging into `main`**, with the "Merge" button of a
pull request `develop` → `main`, or by the owner pushing signed commits to `main`.

Within 5 minutes the deployer on the NAS fetches `main`, checks the signature of the newest commit, checks it out and
runs `docker compose up -d --build`. Accepted signatures (trust lists live only on the NAS, in `/volume1/docker/deployer`):
- GitHub's web-flow key (`github-web-flow.gpg`): merges made on github.com
- SSH keys in `allowed_signers`: the owner's own commits (signed automatically here: `commit.gpgsign`, key `~/.ssh/github.com`)

Commits pushed straight to `main` from anyone else's machine are refused and logged.

```sh
ssh nas 'sudo docker logs -f deployer-deployer-1'      # deploy log
ssh nas 'sudo docker restart deployer-deployer-1'      # retry a failed deploy now
```

Changes to `infra/deployer/` or `infra/cloudflared/` are not applied by the deployer. After pushing, run on the NAS:
`sudo docker compose -f /volume1/docker/warriors/infra/deployer/compose.yaml up -d --build`.

To allow another signing key, add a line `<email> namespaces="git" <public key>` to
`/volume1/docker/deployer/allowed_signers` on the NAS.

The bootstrap logs in with `ADMIN_PASSWORD` from `.env`. After the admin password is changed in Directus, a re-run needs
the current password passed in with `-e ADMIN_PASSWORD=...`.

First deploy only: create `data/postgres` (owner uid 70, mode 700) and `data/uploads` (owner uid 1000) without Synology ACLs
(`synoacltool -del`). Otherwise Postgres fails with `mkdir: can't create directory '/var/lib/postgresql/18/'`.
After the first sync run (the CMS relations need the `dbb_*` tables):

```sh
ssh nas 'cd /volume1/docker/warriors && sudo docker compose exec -T cms node --input-type=module -' < cms/bootstrap.mjs
ssh nas 'cd /volume1/docker/warriors && sudo docker compose restart sync'   # grants the web role read access to the new tables
```

Logs: `ssh nas 'cd /volume1/docker/warriors && sudo docker compose logs -f sync'`

## Backups

The `backup` service writes `data/backups/warriors-YYYY-MM-DD.dump` at start and nightly at 03:30, and keeps 14 days.
These dumps sit on the same NAS. Copy `data/backups` and `data/uploads` (photos) off the NAS as well, e.g. with Hyper Backup.

Restore (replaces the current database content):

```sh
ssh nas 'cd /volume1/docker/warriors && sudo docker compose stop cms sync web \
  && sudo docker compose exec -T backup cat /backups/warriors-YYYY-MM-DD.dump \
   | sudo docker compose exec -T db pg_restore -U warriors -d warriors --clean --if-exists \
  && sudo docker compose start cms sync web'
```

## Local development

Same compose file, with a local env file and localhost ports (`compose.local.yaml` publishes `127.0.0.1:4321` and `:8055`):

```sh
docker network create tunnel   # once
docker compose --env-file .env.local-test -p warriors-local -f compose.yaml -f compose.local.yaml up -d --build
```
