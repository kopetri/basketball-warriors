# CLAUDE.md

Website of the basketball team TG Bad Waldsee Warriors (https://warriors.hartwig-bw.de). Overview and commands: `README.md`.
Why things are built this way: `docs/architecture.md`. Quirks of the basketball-bund.net (DBB) data: `docs/research.md`, part 1.

## This repo is public

Every commit is visible to the world. Before committing, check the diff for personal data and secrets:

- Test data and docs use placeholders for people (`Vorname` / `Person1`, `Max Mustermann`, IDs from `100001`).
  Real names, photos, emails and DBB person IDs of players or referees come only from the database at runtime.
- Secrets live only in `.env` on the server (`.env.example` lists the names). Code reads them from the environment.
- Server internals (IP addresses, other services on the server, tunnel IDs) stay out of the repo.

## Branches and deploying

Work on `develop` or a branch off it, and open pull requests into `develop` (the default branch).
`main` is production: every merge into `main` deploys to the server within 5 minutes. Merges into `main` are done by
the repo owner (`kopetri`), so your pull requests target `develop`.

## Consent gate

Players appear by name, photo or statistics only when their CMS record has `consent = true` and
`status = 'published'`; everyone else shows as "Spieler". Opponent players are never stored by name. Every query
that touches players or box scores keeps this gate (see `boxScore`, `roster`, `player` and `isPublicFile` in
`web/src/lib/data.ts`).

## Website (`web/`)

- Astro, server-rendered. Pages query Postgres directly through `web/src/lib/data.ts`; the database role `web` may only
  SELECT the tables listed in `WEB_TABLES` in `sync/sync.mjs`, so a new table needs an entry there.
- Images: `media(id, width)` from `web/src/lib/format.ts`, served by `web/src/pages/media/[id].ts`, which allows the
  widths 320, 640, 960 and 1600 only. Videos (player intro clips, `players.clip`): `video(id)`, served as the original
  file with Range support (Safari needs it). Only files referenced by published content pass (`isPublicFile`).
  The CMS itself is not reachable from the internet.
- Design: colour tokens on `:root` in `web/src/layouts/Base.astro` (dark theme, colours from the logo), system font
  stack, everything self-hosted. The site sets no cookies and loads nothing from other servers (German privacy law).
- Text on the site is German. Dates come from the database as `YYYY-MM-DD` strings; format them with the helpers in
  `web/src/lib/format.ts`.
- Check layout at 390 px width too: no horizontal page scroll; wide tables scroll inside `.table-scroll`.

## Checks before a pull request

- `node --test sync/map.test.mjs`
- `cd web && npm run build`
- For UI changes: run the local stack (README, "Local development") and look at the changed pages on desktop and mobile.
