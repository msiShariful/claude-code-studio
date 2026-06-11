# Claude Code Studio — Design Spec

**Date:** 2026-06-11
**Status:** Approved direction; pending implementation plan
**Working name:** Claude Code Studio (final npm name to be checked for availability and trademark safety before publish — `cc-studio` is the fallback)

## Problem

Claude Code is configured through scattered files and CLI commands: `~/.claude/settings.json`, the large machine-managed `~/.claude.json` (MCP servers, per-project state), project-level `.claude/settings.json` / `.claude/settings.local.json` / `.mcp.json`, plus plugins, agents, skills, hooks, keybindings, and CLAUDE.md files. Developers who are not comfortable in a terminal struggle to discover, understand, and safely edit this configuration. Even experienced users cannot easily answer "which file is this setting actually coming from?"

## Goal

A public, open-source, cross-platform GUI that manages **all local Claude Code CLI configuration** — everything that can be set up from the CLI — safely and understandably.

## Non-Goals (v1)

- Managing claude.ai / cloud settings, accounts, or billing
- Editing conversation history, sessions, or transcripts
- Being an IDE extension or replacing the Claude Code CLI itself
- Desktop app packaging (deliberately deferred; see Future)

## Form Factor Decision

**npm package that launches a local web app:** `npx claude-code-studio` starts a small local server and opens the GUI in the default browser (the `prisma studio` / `expo` pattern).

Rationale:
- Every Claude Code user has already run at least one terminal command; one memorable command is an acceptable ask, and everything after launch is pure GUI.
- Cross-platform (macOS/Linux/Windows) for free.
- No code-signing/notarization infrastructure; ships and iterates fast; easy for open-source contributors.
- Architected so the same UI can later be wrapped in a desktop shell (Tauri/Electron) for a true zero-terminal download.

Alternatives considered: Tauri desktop app (zero-terminal but heavy release infra, Rust in stack, slow to ship) and Electron (same burden, large binaries). Both rejected for v1; the layered architecture keeps them cheap to add later.

## Architecture

Three layers, one repository (monorepo with workspaces):

```
┌─────────────────────────────────────────────┐
│  packages/web — React + Vite SPA            │
└──────────────────┬──────────────────────────┘
                   │ HTTP, localhost only, token-auth
┌──────────────────┴──────────────────────────┐
│  packages/server — Fastify API, random port │
└──────────────────┬──────────────────────────┘
┌──────────────────┴──────────────────────────┐
│  packages/core — config engine (pure Node)  │
└─────────────────────────────────────────────┘
```

- **packages/core (config engine).** A standalone, UI-agnostic Node library. Knows every config surface, file location, and the settings precedence rules. All reads/writes go through it. This separation is what makes a future desktop wrapper (or third-party reuse) cheap.
- **packages/server.** Thin Fastify HTTP API over the engine. Serves the built web assets in production. Binds `127.0.0.1` only.
- **packages/web.** React SPA. Talks only to the local API.
- **CLI entry point.** The npm bin: picks a free random port, generates a session token, starts the server, opens `http://127.0.0.1:<port>/#token=<token>` in the browser.

## Config Surfaces Managed

Global (user scope):
- `~/.claude/settings.json` — model, permissions, env, hooks, statusline, etc.
- `~/.claude.json` — MCP servers, per-project state (machine-managed; surgical edits only)
- `~/.claude/keybindings.json`
- `~/.claude/agents/`, `~/.claude/skills/`
- `~/.claude/plugins/` and marketplace configuration
- `~/.claude/CLAUDE.md` and memory files

Per-project (via a project switcher in the UI):
- `.claude/settings.json`, `.claude/settings.local.json`
- `.mcp.json`
- `.claude/agents/`, `.claude/skills/`
- `CLAUDE.md`

Enterprise/managed-settings files are displayed read-only when present (they win precedence; users should see them, not edit them).

## Write Strategy & Safety

Trust is the product. Rules, in order:

1. **Prefer the CLI as the API.** Where a `claude` command exists (`claude mcp add/remove`, `claude plugin install`, `claude config set`, …), shell out to it rather than hand-editing files. The CLI owns its formats; we don't reverse-engineer them across versions.
2. **Surgical file edits otherwise.** Parse → modify only the targeted keys → preserve unknown keys verbatim → validate against a JSON schema of known settings (warn on unknown keys, never delete them).
3. **Diff preview before every save.** The user sees exactly what will change in which file and confirms.
4. **Automatic backups.** Timestamped copy of every file before modification, stored under `~/.claude-code-studio/backups/`, with one-click restore in the UI and a retention cap.
5. **External-change detection.** File watcher refreshes the UI when files change outside the tool; never overwrite changes made since last read (compare mtime/hash before write, prompt on conflict).
6. **Graceful degradation.** If the `claude` CLI is not found on PATH, fall back to file-editing mode with a visible warning.

## Security

A localhost HTTP server is reachable from any webpage the user has open, so:
- Bind to `127.0.0.1` only; random high port per session.
- Per-session bearer token generated at launch, delivered via the launch URL fragment, required on every API request.
- Strict CORS (no cross-origin allowed) and `Host` header validation to block DNS-rebinding.
- No remote network calls except npm-registry/marketplace metadata where a feature requires it.

These ship in v1, not later.

## UI Sections (v1)

1. **Dashboard** — effective configuration overview + doctor-style health checks (CLI found? version? malformed files? orphaned backups?).
2. **Effective Settings view** — the killer feature: the merged result of all precedence layers, each value annotated with the file it came from, click-through to edit at the right scope.
3. **Settings editor** — form-based editing of known settings (model, env, statusline, …) with a raw-JSON toggle for power users.
4. **Permissions builder** — allow/deny/ask rules with plain-English explanations of rule syntax.
5. **MCP manager** — list servers with scope and auth status; add via form (stdio/SSE/HTTP); enable/disable/remove.
6. **Plugins & marketplaces** — list marketplaces and installed plugins; install, enable/disable; show each plugin's skills/agents/commands.
7. **Hooks editor** — per-event configuration with plain-English descriptions of each hook event and matcher.
8. **Agents / Skills / CLAUDE.md / memory** — file browser + markdown editor with frontmatter awareness.
9. **Keybindings** — view and edit `keybindings.json`.
10. **Project switcher** — choose any project directory; global vs project scope shown side by side throughout.

## Error Handling

- Malformed JSON in an existing file: show the file with the parse error located; offer raw-edit mode; never write through a parse failure.
- Failed CLI invocation: surface stdout/stderr verbatim with the exact command run.
- Write failures (permissions, disk): report precisely; backups guarantee no partial corruption (write-to-temp + atomic rename).

## Testing

- **Engine:** unit tests against fixture home directories in temp dirs (the bulk of test effort — precedence resolution, surgical edits, backup/restore, conflict detection).
- **Server:** API integration tests over the engine with fixtures.
- **UI:** a small number of Playwright e2e flows — edit setting → diff → save → restore backup; add MCP server via form.

## Distribution

- Single npm package; `npx claude-code-studio` works without install. Node ≥ 18.
- Web assets bundled into the package (no build step at user's machine).
- Versioning note in README: the tool tracks Claude Code config formats; CLI-first write strategy minimizes breakage when formats evolve.

## Future (explicitly out of v1)

- Tauri desktop wrapper (.dmg/.msi/.AppImage) reusing the same web UI and engine.
- Import/export or sync of settings between machines.
- Team-shared settings templates.
