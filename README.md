# worldcup-pool

A prediction pool for the 2026 FIFA World Cup: group-stage match picks, a bracket
of how far each team goes, live results sync from ESPN, and standings with a
points breakdown and a still-reachable ceiling per player.

## This repo is a module, not an app

It has no `package.json`, no build config, and no deploy config. It is mounted at
`/worldcup` by the **`home`** shell app, which owns the dependencies, the build,
and the Databricks App deployment. Clone `home` and work there — this repo lives
at `apps/worldcup` inside it as a git submodule.

- `server/` — Express routes registered through `appkit.server.extend`, the
  Postgres schema (`pool`), seed fixtures, and the ESPN results sync.
  Entry point: `setupPoolRoutes(appkit, { distPath })`.
- `client/` — React SPA built with Vite `base: '/worldcup/'` and a React Router
  `basename` of `/worldcup`.

The shell passes `distPath` in, so this module never assumes where it sits on
disk. The `/worldcup` URL prefix, however, is baked into the routes, the Vite
base, the router basename, and `client/public/site.webmanifest`.

## Changing something here

Commit and push in this repo first, then commit the updated submodule pointer in
`home`. Build and test from `home` (`npm run build:worldcup`, `npm run dev`).

See [INVITING_PLAYERS.md](INVITING_PLAYERS.md) for adding players and running the
pool as admin.

## History

Until August 2026 this repo was the whole Databricks App (`worldcup-pool`), and
for a while it also carried the todolist app. Both were split out: the todolist
into its own repo, the shell into `home`. Everything before that split is in this
repo's history.
