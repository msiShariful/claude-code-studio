# Claude Code Studio

A local GUI for managing Claude Code settings — config files, MCP servers,
plugins, hooks, agents, skills, and CLAUDE.md — without living in the terminal.

> Status: early development. The config engine (`packages/core`) is being
> built first; the local API server and web UI follow. See
> `docs/superpowers/specs/` for the design and `docs/superpowers/plans/`
> for implementation plans.

## Planned usage

```bash
npx claude-code-studio
```

One command starts a localhost-only server and opens the GUI in your browser.

## Architecture

- `packages/core` — config engine: reads/writes every Claude Code config
  surface with diff previews, automatic backups, and conflict detection.
  Prefers shelling out to the `claude` CLI over hand-editing its files.
- `packages/server` — (planned) localhost-only Fastify API, token-protected.
- `packages/web` — (planned) React UI.

## Development

```bash
npm install
npm test
```

Requires Node ≥ 18.
