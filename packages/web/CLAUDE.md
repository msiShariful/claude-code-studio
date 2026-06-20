# packages/web — `@claude-code-studio/web`

React 19 + Vite SPA. Private; built into `dist/` and served by `cc-studio`.

## Structure (`src/`)

- `main.tsx` — boots: `bootstrapToken(window)` pulls the token from the URL hash, then renders
  `<App>`.
- `App.tsx` — token gate, then `<BrowserRouter><Shell/></BrowserRouter>`.
- `shell/` — the app chrome. `Shell.tsx` parses the URL into `{ workspace, section }`, renders
  the top bar (wordmark + `WorkspaceSwitcher` + CLI status), the section `Sidebar`, and the
  active view. `WorkspaceSwitcher.tsx`, `Sidebar.tsx`, `fileTree.ts`, `icons.tsx`.
- `nav.ts` — **single source of truth** for sections (key, plain-language label, technical term,
  info tooltip, and `kinds` — which workspace scopes show it). The breadcrumb, routes, and view
  tooltips derive from it. Add a section here.
- `shell/Sidebar.tsx` — the section nav, drawn as the real Claude Code config **file tree**
  (mono filenames, indent guides, a rotating caret on `.claude/`, an amber active bleed-bar, and a
  green/hollow status dot per artifact fetched the same way `Home` computes its tiles). The tree
  shape lives in `shell/fileTree.ts` (each node maps to a `nav.ts` section key + plain-language
  `info`; `kinds` prunes per scope); glyphs are inline SVGs in `shell/icons.tsx`. Keep the `<nav>`'s
  `aria-label="Sections"` so tests can scope to it.
  - **One node, one view.** Most tree nodes map 1:1 to a section, so the last-clicked node owns the
    highlight (falling back to the first node for the active section on reload). The files used to be
    one `agents` section with in-view tabs; they're now four real sections — `memory` (CLAUDE.md),
    `agents`, `skills`, `keybindings` (global/user only) — all rendered by `Files` with a `kind`
    prop and **no tab bar**. The one place tabs remain is `Editor` (settings): `settings.json`→
    `project`/`user`, `settings.local.json`→`projectLocal` share the `settings` section, so clicking a
    node opens the matching tab via a one-shot `editorJump` (consumed in an effect so it switches even
    when mounted), and the Editor reports its live tab back up (`onScopeChange` → `settingsScope`) so
    the sidebar highlight follows tab clicks too. Extensions plays the same trick with its
    `Everyone`/`Just me` pills, which show each settings file's plugin overrides separately.
- `views/` — one component per section: `Home` (dashboard), `Editor` (settings), `Mcp` (tools),
  `Files` (memory / agents / skills / keybindings, by `kind`), `Hooks` (automation), `Plugins`
  (extensions), `Effective`, `Backups`. Plus `JsonView` (foldable JSON) in `components/`.
- `components/ui.tsx` — shared primitives: `PageHeader`, `Card`, `StatusPill`, `InfoTip`,
  `EmptyState`. Compose these instead of hand-rolling chrome.
- `components/CodeEditor.tsx` — a CodeMirror 6 wrapper (line numbers, fold gutter, dark theme +
  highlight matching the design tokens). `Files` uses it to **edit** CLAUDE.md / agents / skills
  (Markdown) and keybindings.json (JSON). Controlled (`value` + optional `onChange`); `disabled` is
  transient (mid-save), `readOnly` is a permanent viewer. It's **lazy-loaded** (`React.lazy` +
  `Suspense`) so CodeMirror lands in its own chunk, not the initial bundle.
- `components/JsonViewer.tsx` — a thin `readOnly` JSON wrapper around the lazy `CodeEditor`. Used by
  `Editor` (the settings.json display, replacing the old hand-rolled `JsonView`) and `Hooks` (each
  event's config preview) so every read-only JSON gets the same colours/line-numbers/folding, with
  editing still routed through the Settings editor.
- CodeMirror needs layout APIs jsdom lacks, so tests that render it **mock** `components/CodeEditor`
  (a textarea in `files-view.test.tsx`; a `<pre>` in `editor.test.tsx` / `hooks-view.test.tsx`). The
  preview is lazy, so assert its contents with `findBy*`, not `getBy*`.
- `api.ts` — typed `Api` client (one method per endpoint) + DTOs. `workspace.ts` — `Workspace`
  type + `encodeProjectId`/`decodeProjectId` (base64url for reload-safe URLs).
- `mcpCatalog.ts` / `pluginCatalog.ts` — curated, offline, searchable catalogs (+ `filter…`).
- `styles.css` — design tokens (CSS vars) + component styles. Dark theme; Inter (sans), IBM Plex
  Mono (data), Instrument Serif (wordmark).

## Workspace scopes

Three scopes, selected in `WorkspaceSwitcher`: **Global** (aggregate — every scope, all projects),
**User** (machine-wide `~/.claude` / user scope only), and **Project** (a project's project + local
scope, never user-scope items). `Workspace` (`workspace.ts`) is the discriminated union; each view
filters its list/tabs by `workspace.kind` (Global → all, User → user scope, Project → project/local).
Global and User edit the same machine-level files (settings, agents, hooks); they differ in the
aggregate list views (MCP, Plugins, Backups), where Global shows everything.

Plugins are the exception to "Project never shows user-scope items": because plugins are installed
machine-wide and only enabled/disabled per project, the Project Extensions view *does* list the
inherited user-scope plugins (as active, "From User") and lets each be toggled on/off for that
project alone — written to `.claude/settings.local.json` via `claude plugin enable/disable --scope
local` run in the project dir. `GET /api/plugins?projectDir=` returns the project's `enabledPlugins`
override map for this.

## Routing

Path-based: `/global/<section>`, `/user/<section>`, and `/project/<base64url(dir)>/<section>`.
`home` = bare base. The server's SPA fallback makes every path reload-safe. Last route is persisted
to localStorage for the bare-URL landing.

## Rules

- New section = add to `nav.ts`, map it in `Shell.tsx#renderSection`, give the view a `PageHeader`
  with an `info` tooltip (plain language, teaches the Claude term).
- Tests (`tests/*.test.tsx`) are jsdom + RTL: `// @vitest-environment jsdom`, explicit
  `cleanup()` + `vi.unstubAllGlobals()` in `afterEach`, stub `fetch`, reset `window.history`/
  `localStorage` between tests. Scope nav clicks with `within(getByRole('navigation', {name:'Sections'}))`.
- Keep labels plain-language; surface jargon through `InfoTip`, not the label itself.
