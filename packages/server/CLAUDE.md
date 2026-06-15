# packages/server — published as `cc-studio`

Fastify API + the `cc-studio` bin. Serves the built SPA, exposes the config engine over HTTP,
and opens a browser. **This is the only published package.**

## Structure (`src/`)

- `bin.ts` — entry (`#!/usr/bin/env node`). Mints a session token, finds the web root
  (`../web-dist` published, `../../web/dist` in the monorepo), starts the server on
  `127.0.0.1:0`, prints `…/#token=…`, opens the browser.
- `server.ts` — `buildServer(opts)` → Fastify app. `ServerContext` carries `globalPaths`,
  `backupsRoot`, and an injectable `runner: CliRunner` (defaults to `runCommand`). Registers
  security, the `/api/*` routes, and static SPA serving with a `setNotFoundHandler` →
  `index.html` fallback (so client-side deep links survive reload).
- `auth.ts` — bearer-token guard (`requireBearerToken`) + security headers.
- `routes/` — one file per area: `settings`, `mcp`, `plugins`, `files`, `backups`, `projects`.
  Routes validate input, call `@claude-code-studio/core`, and surface CLI non-zero exits as
  HTTP 400 with the verbatim command output.
- `config.ts` — token creation.
- `scripts/bundle.mjs` — esbuild bundle of the server to `dist/`. `scripts/prepack.mjs` — copies
  `packages/web/dist` → `web-dist` for the published tarball.

## Rules

- `files: ["dist","web-dist"]` is a publish **whitelist** — source, `CLAUDE.md`, and `.claude/`
  never ship. Keep it that way.
- Build is `tsc --noEmit` (typecheck) + `node scripts/bundle.mjs`. There is no emitted `tsc` output.
- Tests in `tests/` use `helpers.ts#fixture()` (temp HOME + real `buildServer`) and inject fake
  runners; assert via `app.inject(...)`. Add a route test alongside any new endpoint.
- Validate every request body/param (absolute paths, allowed scopes, object shapes) before
  touching core.
