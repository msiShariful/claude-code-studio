# Publish Readiness Implementation Plan (Plan ⑥)

> **For agentic workers:** Tasks are tightly coupled and environment-dependent (npm pack behavior); execute sequentially with verification after each step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `npx cc-studio` work from the npm registry: one published package containing the bundled server (core inlined) and the built web UI.

**Architecture:** `packages/server` becomes the published package, renamed `cc-studio` (the product stays "Claude Code Studio"; `claude-code-studio` on npm is taken by a third party, `cc-studio` is free — the spec's designated fallback). The server's build gains an esbuild bundling step that inlines the workspace-internal `@claude-code-studio/core` (and its only dep, `diff`) into `dist/`, leaving `fastify`/`@fastify/static` as normal registry dependencies. A `prepack` script copies `packages/web/dist` into the package as `web-dist/` and fails loudly if it's missing; the bin resolves `webRoot` from candidates (`../web-dist` packaged, `../../web/dist` monorepo dev). `files` allowlists keep tarballs clean; core/web are marked private so they can't be published by accident; MIT license added (public open-source project).

**Publish flow (documented in README):** `npm run build` at the root → `npm publish -w cc-studio`.

---

### Task 1: Rename + package metadata + license

- [ ] `packages/server/package.json`: name `cc-studio`, version `0.1.0`, description, keywords, license MIT, `bin: {"cc-studio": "./dist/bin.js"}`, `files: ["dist", "web-dist"]`, engines node ≥18; move `@claude-code-studio/core` from dependencies to devDependencies (it gets bundled); remove the now-stale `types` field if the bundle stops emitting d.ts.
- [ ] `packages/core/package.json` + `packages/web/package.json`: `"private": true` (bundled/copied, never published). Core also gets `files: ["dist"]` for hygiene.
- [ ] Root `LICENSE`: MIT, `Copyright (c) 2026 msiShariful`.
- [ ] `packages/web/src/App.tsx`: gate message `npx claude-code-studio` → `npx cc-studio`.
- [ ] `npm install` to refresh the lockfile; `npx vitest run` stays green (137).
- [ ] Commit: `chore: rename published package to cc-studio with publish metadata`

### Task 2: esbuild bundling of the server

- [ ] Add `esbuild` to server devDependencies.
- [ ] `packages/server/scripts/bundle.mjs`: esbuild API — entries `src/bin.ts` + `src/index.ts`, outdir `dist`, bundle, platform node, format esm, target node18, `external: ['fastify', '@fastify/static']` (everything else — core, diff — inlined).
- [ ] Server `build` script: `tsc -p tsconfig.json --noEmit && node scripts/bundle.mjs` (tsc keeps type safety; esbuild emits).
- [ ] Verify: `dist/bin.js` keeps its shebang; `grep '@claude-code-studio/core' dist/*.js` finds nothing; `node dist/bin.js` boots (then kill).
- [ ] Commit: `feat(server): bundle core into the published dist via esbuild`

### Task 3: web-dist packaging + webRoot candidates

- [ ] `packages/server/scripts/prepack.mjs`: verify `dist/bin.js` and `../web/dist/index.html` exist (fail with a "run npm run build at the repo root" message otherwise); rm-rf + copy `../web/dist` → `./web-dist`.
- [ ] Server `prepack` script: `node scripts/prepack.mjs`.
- [ ] `bin.ts`: webRoot = first candidate of `['../web-dist', '../../web/dist']` (relative to `import.meta.url`) containing `index.html`.
- [ ] `.gitignore`: add `web-dist/`.
- [ ] Commit: `feat(server): package web assets via prepack with dev/packaged webRoot resolution`

### Task 4: Pack verification + tarball smoke test

- [ ] `npm pack --dry-run -w cc-studio`: tarball contains `dist/bin.js`, `dist/index.js`, `web-dist/index.html`, `web-dist/assets/*`; no `src/`, no `tests/`.
- [ ] Real-world test: `npm pack -w cc-studio` into /tmp, `npm install <tarball>` in a fresh temp dir, run `node_modules/.bin/cc-studio`, curl `/` (expect real SPA index) and unauthenticated `/api/health` (expect 401), kill. This is the actual `npx` user path.
- [ ] Commit (if any fixes were needed): `fix: <whatever the smoke test surfaced>`

### Task 5: README + docs

- [ ] README: usage `npx cc-studio`; install/publish section for contributors; note the product name vs npm name.
- [ ] Commit: `docs: cc-studio usage and publishing notes`

**Deferred (tracked, not in this plan):** Playwright e2e against the packaged artifact; JSON-schema validation of known settings keys; file watcher; permissions builder; memory files; actual `npm publish` (user runs it — requires their npm account).
