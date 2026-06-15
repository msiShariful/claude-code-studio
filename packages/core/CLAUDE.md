# packages/core — `@claude-code-studio/core`

The config engine. Pure TypeScript, no HTTP, no framework. Everything that reads or mutates
Claude's on-disk configuration lives here so it can be unit-tested in isolation. Private —
consumed by `packages/server`.

## Key modules (`src/`)

- `paths.ts` — resolves Claude's config locations (`~/.claude`, `~/.claude.json`, project
  `.claude/`, `.mcp.json`) from env + platform.
- `json-file.ts` — `readJsonFile` (returns `{ value, raw, hash, exists, parseError }`) and
  `writeJsonFileAtomic` (temp-file + rename, with `expectedHash` optimistic-concurrency guard).
- `backups.ts` — `backupFile` snapshots a file before any write; restore support.
- `settings.ts` / `precedence.ts` — settings scopes (user/project/projectLocal/managed) and the
  merge that produces the "effective" config + per-key source.
- `edits.ts` — applies key/value edits, builds diffs (`createTwoFilesPatch`).
- `mcp.ts` — `readMcpServers`, `addMcpServer`/`removeMcpServer` (via injected CLI runner with a
  file-edit fallback), and `readMcpHealth`/`parseMcpHealth` (parses `claude mcp list`).
- `cli.ts` — `CliRunner` type + `runCommand` (execFile, never a shell; non-zero exits resolve,
  missing binaries/timeouts throw). Injectable so tests substitute a fake runner.
- `plugins.ts`, `text-file.ts`, `managed-files.ts` — plugin listing, raw text files, managed files.

## Rules

- Never shell out with string interpolation — use `runCommand`/`execFile` arg arrays.
- Treat the CLI as the owner of config formats; pass configs through untouched where possible.
- Reject prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
- Writes go through `writeJsonFileAtomic` with a hash guard and a backup first — never a bare write.
- Tests in `tests/` (e.g. `mcp.test.ts`, `mcp-health.test.ts`) use real temp dirs via `fixtures.ts`
  and fake `CliRunner`s. Add a test first.
