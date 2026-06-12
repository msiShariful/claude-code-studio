# Workspaces & Visual Redesign (v1.1)

**Date:** 2026-06-12
**Status:** Approved
**Builds on:** `2026-06-11-claude-code-studio-design.md` (v1 spec)

## Problem

Three issues reported against v1:

1. **Project selection is path-based and single.** The sidebar has a free-text
   "project directory" input. Users should pick from a panel listing their real
   projects and switch between them.
2. **Global and project config are mixed.** Every view shows user-level and
   project-level data together (scope tabs side by side), which is confusing.
   Global (user/system) configuration and per-project configuration must be
   separated structurally, not by filters.
3. **The UI needs to be modern and elegant** — the all-mono terminal-luxe skin
   reads as niche rather than professional.

## Decisions (from brainstorming)

- **Project switcher, one active at a time.** The panel lists all known
  projects; clicking one makes it active. No pinned tabs, no side-by-side.
- **Two workspaces: Global and Project.** No view ever mixes scopes across the
  boundary. The Effective view lives inside the project workspace, clearly
  labeled as a merged result.
- **Modern dashboard visual language, mono reserved for data**
  (Linear/Vercel-class), replacing terminal-luxe.
- **Approach A:** frontend restructure plus one new read-only server endpoint.
  No server-side project registry — the server reads the project list Claude
  Code itself maintains, so it can never drift from reality.

## 1. Information architecture

Sidebar with two groups; nothing mixes:

```
◆ Claude Code Studio
─────────────────────
GLOBAL
  Overview          ← env health, CLI status (v1 Dashboard)
  Settings          ← user settings.json (+ managed, read-only tab)
  MCP Servers       ← user-scope servers from ~/.claude.json
  Plugins           ← CLI-global by nature
  Agents & Files    ← user CLAUDE.md, agents, skills, keybindings
  Hooks             ← user-scope hooks
  Backups           ← single backup root, so global
─────────────────────
PROJECTS
  ▾ ERP-Web-Panel   ← active project expands in place
      Effective     ← merged result w/ source badges (landing view)
      Settings      ← project + projectLocal tabs only
      MCP Servers   ← project scope + .mcp.json
      Agents & Files
      Hooks
  ▸ uigen
  + Add project…
```

- Clicking a project expands its nested nav and lands on **Effective** — the
  merged view with per-value source badges and click-to-edit.
- The Global group never shows project data; a project section never shows
  user-level data.
- A top bar in the content area shows location: `Global / Settings` or
  `ERP-Web-Panel / Hooks`.
- Editor jump links (from Hooks and Effective rows) carry the workspace so they
  land on the correct scope tab.

### Scope-to-workspace mapping

| View | Global workspace | Project workspace |
| --- | --- | --- |
| Settings editor | `user` tab + `managed` (read-only) tab | `project` + `projectLocal` tabs |
| Effective | — (not shown) | merged all-scope result with source badges |
| MCP servers | user scope (`~/.claude.json` mcpServers) | project scope + `.mcp.json` |
| Agents & files | user CLAUDE.md, agents, skills, keybindings | project CLAUDE.md, agents, skills |
| Hooks | user hooks + managed (read-only) | project + projectLocal hooks |
| Plugins | shown | — |
| Backups | shown | — |
| Overview (env health) | shown | — |

## 2. Project list & picker

**New endpoint: `GET /api/projects`** (read-only, behind the existing bearer
token hook in the encapsulated api plugin).

- Reads the keys of `projects` in `~/.claude.json` — the list Claude Code
  itself maintains.
- Returns `{ projects: [{ dir, name, exists }] }` where `name` is the folder
  basename and `exists` is an on-disk `existsSync` check.
- Accepts `?extra=<comma-separated dirs>`; extras are merged into the response
  (deduplicated against the known list) and stamped with `exists` the same way.
  Extras only ever hit `existsSync` — no reads, no writes.

**Client behavior:**

- Missing directories render grayed with a "missing" badge and cannot be
  entered.
- "+ Add project…" accepts a path for directories Claude Code hasn't seen;
  extras persist in `localStorage` (`ccs-extra-projects`) and ride along as
  `?extra=`. Extras can be removed from the list.
- The active workspace (the full `{kind, dir}` union, which also drives
  sidebar expansion) persists in `localStorage` (`ccs-workspace`), restored on
  load. The v1 `ccs-project-dir` key is retired.

## 3. Visual design system

Terminal-luxe retires. New system:

- **Typography:** Inter (`@fontsource/inter`, offline) for all UI chrome —
  nav, headings, labels, descriptions. IBM Plex Mono only where content is
  code: paths, JSON values, env vars, diff lines, permission rules. Instrument
  Serif italic wordmark stays as the single brand flourish.
- **Color:** near-black base `#0e1012`, elevated card surfaces `#16181c`,
  hairline borders at ~8% white, text tones bright `#ededf0` / dim `#8b8d98`.
  Amber accent demoted to intentional moments: active nav item, primary
  buttons, focus rings. Scanline texture removed. Scope badge colors are
  unchanged (user teal `#6fd0bd`, project green `#a3cf6b`, projectLocal amber
  `#ffb454`, managed red `#e0705e`) — they carry semantics.
- **Components:** content lives on cards — 8px radius, 1px border, title plus
  one-line description per section. Consistent empty states with a hint line.
  Visible hover/focus states; disabled-while-busy behavior kept from v1.
- **Layout:** fixed ~240px sidebar; content column max-width ~960px; top bar
  with location breadcrumb.

## 4. Code changes

**Server (only addition, nothing else moves):**

- `packages/server/src/routes/projects.ts` + registration in the api plugin
  (inherits token auth automatically) + route tests.

**Web:**

- `App.tsx` rebuilt around workspace state:
  `{ kind: 'global' } | { kind: 'project', dir: string }` — replaces the flat
  view list and the path textbox.
- Each view gains a `workspace` prop controlling which scope tabs render (see
  mapping table). Views already accept `projectDir`; no API changes needed for
  them.
- `api.ts` gains `listProjects(extra: string[])`.
- `styles.css` rewritten on the new design system; `@fontsource/inter` added.
- Editor `EditorJump` carries workspace context.

## 5. Edge cases & error handling

- `~/.claude.json` absent or without `projects` → empty list; "+ Add project"
  still works.
- Active project deleted from disk while open → non-blocking banner in the
  workspace ("directory no longer exists"); views degrade to their existing
  empty/error states.
- `?extra=` paths: `existsSync` only; behind token auth like every route.
- Prototype-pollution and traversal guards from v1 remain untouched — this
  feature adds no new write paths.

## 6. Testing

Same TDD discipline as v1:

- **Server route tests:** list shape from a fixture `~/.claude.json`; missing
  file → empty list; extras merged, deduplicated, and stamped; 401 without
  token.
- **Component tests (jsdom + RTL, explicit `cleanup()`):** sidebar group
  rendering; project expand/switch; localStorage persistence and restore;
  missing-dir gating; "+ Add project" flow; jump-link landing on the right
  workspace and scope tab; per-view scope-tab gating by workspace.
- **Regression:** all 137 existing tests stay green (updated where the
  `workspace` prop changes view contracts).

## Out of scope (unchanged post-v1 backlog)

Playwright e2e, JSON-schema validation, file watcher, permissions builder UI,
memory files, MCP auth status, plugin component inventories, Tauri wrapper.
