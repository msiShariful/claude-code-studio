# Claude Code Studio

A local GUI for managing Claude Code settings — config files, MCP servers,
plugins, hooks, agents, skills, and CLAUDE.md — without living in the terminal.

> Status: early development. Config engine, localhost API server + launcher,
> web UI core (dashboard, effective settings, editor with diff preview,
> backups), and MCP + plugin management are done. Next up: hooks, agents,
> skills, and CLAUDE.md editors.

## Planned usage

```bash
npx claude-code-studio
```

One command starts a localhost-only server and opens the GUI in your browser.

## Architecture

- `packages/core` — config engine: reads/writes every Claude Code config
  surface with diff previews, automatic backups, and conflict detection.
  Prefers shelling out to the `claude` CLI over hand-editing its files.
- `packages/server` — localhost-only Fastify API + `claude-code-studio` bin.
  Token-protected, Host/Origin validated, random port per session.
- `packages/web` — React + Vite SPA: dashboard, effective-settings view with
  per-scope source attribution, settings editor with diff preview/apply, and
  backup restore. Served by the local server; the session token travels in
  the launch URL fragment.

## Development

```bash
npm install
npm test
```

Requires Node ≥ 18.
