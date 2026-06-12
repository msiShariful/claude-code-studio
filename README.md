# Claude Code Studio

A local GUI for managing Claude Code settings — config files, MCP servers,
plugins, hooks, agents, skills, and CLAUDE.md — without living in the terminal.

> Status: v1 feature-complete and packaged. Published to npm as **`cc-studio`**
> (the `claude-code-studio` name was already taken; the product keeps its
> full name).

## Usage

```bash
npx cc-studio
```

One command starts a localhost-only server and opens the GUI in your browser.
Everything stays on your machine: the server binds to 127.0.0.1 on a random
port, every API call requires a per-session token delivered through the
launch URL, and cross-origin requests are rejected.

What you can do from the GUI:

- **Dashboard** — Claude CLI detection, settings-file health, quick stats
- **Effective settings** — the merged result of every settings file, each
  value badged with the scope it comes from; click any value to edit it at
  its source
- **Editor** — change any setting via dotted paths with a color diff preview
  before anything is written; conflicts are detected, never overwritten
- **Agents & files** — edit CLAUDE.md, agents, skills, and keybindings
- **Hooks** — browse lifecycle hook events with plain-English descriptions
- **MCP servers** — list/add/remove across user, local, and project scopes
- **Plugins** — install, enable/disable, uninstall plugins and marketplaces
- **Backups** — every write is backed up first; restore with one click

Writes prefer the `claude` CLI where one exists (`claude mcp …`,
`claude plugin …`) and fall back to careful, backed-up file edits when it
doesn't.

## Architecture

- `packages/core` — config engine: reads/writes every Claude Code config
  surface with diff previews, automatic backups, and conflict detection.
- `packages/server` — published as `cc-studio`: localhost-only Fastify API +
  the `cc-studio` bin. Token-protected, Host/Origin validated, random port
  per session. The core engine is bundled in; the built web UI ships inside
  the package as `web-dist/`.
- `packages/web` — React + Vite SPA served by the local server; the session
  token travels in the launch URL fragment.

## Development

```bash
npm install
npm test        # 137 tests across core, server, and web
npm run build   # builds all three packages
node packages/server/dist/bin.js   # run the built app locally
```

Requires Node ≥ 18.

## Publishing (maintainers)

```bash
npm run build                 # build core, server bundle, and web assets
npm publish -w cc-studio      # prepack copies web assets into the tarball
```

`prepack` fails loudly if the web assets are missing, and `npm pack --dry-run
-w cc-studio` shows exactly what ships (`dist/` + `web-dist/`, nothing else).

## License

MIT
