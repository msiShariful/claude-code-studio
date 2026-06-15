# packages/web — `@claude-code-studio/web`

React 19 + Vite SPA. Private; built into `dist/` and served by `cc-studio`.

## Structure (`src/`)

- `main.tsx` — boots: `bootstrapToken(window)` pulls the token from the URL hash, then renders
  `<App>`.
- `App.tsx` — token gate, then `<BrowserRouter><Shell/></BrowserRouter>`.
- `shell/` — the app chrome. `Shell.tsx` parses the URL into `{ workspace, section }`, renders
  the top bar (wordmark + `WorkspaceSwitcher` + CLI status), the section `Sidebar`, and the
  active view. `WorkspaceSwitcher.tsx`, `Sidebar.tsx`.
- `nav.ts` — **single source of truth** for sections (key, plain-language label, technical term,
  info tooltip, scope). The sidebar, breadcrumb, routes, and tooltips all derive from it. Add a
  section here.
- `views/` — one component per section: `Home` (dashboard), `Editor` (settings), `Mcp` (tools),
  `Files` (agents/skills/CLAUDE.md), `Hooks` (automation), `Plugins` (extensions), `Effective`,
  `Backups`. Plus `JsonView` (foldable JSON) in `components/`.
- `components/ui.tsx` — shared primitives: `PageHeader`, `Card`, `StatusPill`, `InfoTip`,
  `EmptyState`. Compose these instead of hand-rolling chrome.
- `api.ts` — typed `Api` client (one method per endpoint) + DTOs. `workspace.ts` — `Workspace`
  type + `encodeProjectId`/`decodeProjectId` (base64url for reload-safe URLs).
- `mcpCatalog.ts` / `pluginCatalog.ts` — curated, offline, searchable catalogs (+ `filter…`).
- `styles.css` — design tokens (CSS vars) + component styles. Dark theme; Inter (sans), IBM Plex
  Mono (data), Instrument Serif (wordmark).

## Routing

Path-based: `/global/<section>` and `/project/<base64url(dir)>/<section>`. `home` = bare base.
The server's SPA fallback makes every path reload-safe. Last route is persisted to localStorage
for the bare-URL landing.

## Rules

- New section = add to `nav.ts`, map it in `Shell.tsx#renderSection`, give the view a `PageHeader`
  with an `info` tooltip (plain language, teaches the Claude term).
- Tests (`tests/*.test.tsx`) are jsdom + RTL: `// @vitest-environment jsdom`, explicit
  `cleanup()` + `vi.unstubAllGlobals()` in `afterEach`, stub `fetch`, reset `window.history`/
  `localStorage` between tests. Scope nav clicks with `within(getByRole('navigation', {name:'Sections'}))`.
- Keep labels plain-language; surface jargon through `InfoTip`, not the label itself.
