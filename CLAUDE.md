# Claude Code Studio — project guide

A local web GUI for managing Claude Code configuration (settings, MCP servers, agents,
hooks, plugins, memory files) without hand-editing JSON. Runs on localhost only, no
telemetry, no network calls beyond the user's own machine.

Published to npm as **`cc-studio`** (`npx cc-studio`). Repo: `msiShariful/claude-code-studio`.

## Monorepo layout

npm workspaces, ESM throughout (`"type": "module"`), TypeScript strict.

- **`packages/core`** — `@claude-code-studio/core` (private). The config engine: reads/writes
  Claude's JSON files atomically with hash guards + backups, MCP read/write, settings
  precedence. Pure, no HTTP. See `packages/core/CLAUDE.md`.
- **`packages/server`** — published as **`cc-studio`**. Fastify API + the `cc-studio` bin that
  serves the SPA and opens a browser. See `packages/server/CLAUDE.md`.
- **`packages/web`** — `@claude-code-studio/web` (private). React 19 + Vite SPA. See
  `packages/web/CLAUDE.md`.

Only `cc-studio` is published; the server's `files: ["dist","web-dist"]` whitelist means
**nothing in `.claude/` or these `CLAUDE.md` files ever ships to npm** — they are GitHub-only.

## Commands

| Task | Command |
|------|---------|
| Run all tests | `npm test` (vitest run at root) |
| Type-check everything | `npm run typecheck` |
| Build everything | `npm run build` |
| Build + run the app locally | `npm run preview` (then open the printed `…/#token=…` URL) |
| Cut a release | `/release <version>` (see `.claude/commands/release.md`) |

**Definition of done for any change:** `npm run typecheck`, `npm test`, and `npm run build`
all green. Run them before committing.

## Conventions

- **TDD.** Write or update a test first, watch it fail, then implement. Tests live in each
  package's `tests/`. Vitest 4; component tests use jsdom + React Testing Library with an
  explicit `cleanup()` in `afterEach` and a `// @vitest-environment jsdom` docblock. Vitest
  globals are OFF — import `describe/it/expect/vi` explicitly.
- **ESM import specifiers.** NodeNext resolution: relative imports MUST end in `.js` (even
  for `.ts`/`.tsx` sources), e.g. `import { Api } from '../api.js'`.
- **Small, focused files.** One clear responsibility each. When a file grows past its purpose,
  split it. Match the surrounding code's style, naming, and comment density.
- **Conventional commits**, scoped: `feat(web): …`, `fix(core): …`, `chore: …`, `test(server): …`,
  `docs: …`, `style(web): …`. Subject in imperative mood.

### Commit policy (strict)

- Commit as the user with a plain `git commit`. **NEVER** add a `Co-Authored-By` trailer.
- **NEVER** mention Claude, AI, or "generated with" anywhere in a commit message.
- The `includeCoAuthoredBy: false` setting and the `.claude/hooks/guard-commit.mjs` PreToolUse
  hook both enforce this — a commit carrying those trailers is blocked.
- Commit after each small, verified step. Branch off `main` before committing only if asked;
  this project commits to `main` directly and pushes when the user says so.

### Security

- The npm auth token (in `~/.npmrc`) is a secret — never print, echo, or reproduce it.
  `~/.npmrc` and `.env*` are denied to Read in `.claude/settings.json`.
- Publishing (`npm publish`) is gated to `ask` so it always prompts.

## Releasing

Version + publish flow (also encoded in `/release`):

```
npm version <v> -w cc-studio --no-git-tag-version
npm run build && npm test
npm publish -w cc-studio        # prompts; user authenticates
git commit -aqm "chore: release cc-studio <v>"
git push
git tag -a v<v> -m "cc-studio <v>" && git push origin v<v>
gh release create v<v> --verify-tag --title "…" --notes "…"
```

The `cc-studio` package version is the source of truth (private packages stay at 0.1.0).
`prepack` copies `packages/web/dist` → `packages/server/web-dist`; a stale `web-dist` from a
prior publish can shadow a fresh build when running locally — `npm run preview` removes it.
