# Web UI Core Implementation Plan (Plan ③)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/web` — the React SPA (dashboard, effective-settings view, settings editor with diff preview/apply, backups/restore) — and serve its built assets from the Fastify server so `npx claude-code-studio` opens a real GUI.

**Architecture:** The server gains a `webRoot` option: when it points at a built SPA, `@fastify/static` serves the assets outside the token-protected API plugin, with an SPA fallback in the not-found handler (`/api/*` still 404s as JSON). The SPA is a Vite + React app with no router dependency: a state-switched sidebar nav over four views. The launcher delivers the token in the URL fragment; the SPA stores it in `sessionStorage`, strips it from the URL, and sends `Authorization: Bearer` on every call. Views are thin over the existing API: the editor builds dotted-path `edits`, previews the server-computed diff, and applies with the previewed `expectedHash` (409 → "file changed, re-preview").

**Tech Stack:** React 19, Vite 6, TypeScript (bundler resolution for web only), `@fastify/static` ^8, Vitest + jsdom + Testing Library for the few unit/component tests. Fonts bundled via `@fontsource` (offline — no CDN).

**Design direction (commit to it):** terminal-luxe. IBM Plex Mono is the primary UI typeface everywhere ("everything is config"), with Instrument Serif italic reserved for the wordmark and view titles. Warm charcoal background with a faint scanline texture, phosphor-amber accent. The signature element: **every value in the effective view carries a color-coded scope badge** (user = teal, project = green, projectLocal = amber, managed = red) — the same hues thread through the editor's scope picker and the dashboard. No purple gradients, no Inter, no card-grid genericism.

**Plan sequence for v1** (this is Plan ③): ① core engine (done) → ② API server + launcher (done) → ③ web UI core (this plan) → ④ MCP + plugins → ⑤ remaining editors.

**Design notes the engineer must know:**
- The token never reaches the server in a URL. Fragment → `sessionStorage` → `Authorization` header. If no token is found, the SPA renders a gate screen telling the user to reopen via the terminal URL.
- `@fastify/static` registers a wildcard GET route; when a file is missing it calls Fastify's not-found handler, which is where the SPA fallback lives. The fallback serves `index.html` for non-`/api` GETs only. A raw-string `startsWith('/api')` check is acceptable HERE (unlike auth) because it is fail-closed: worst case a weirdly-encoded API path gets `index.html` instead of a JSON 404 — no protected data involved.
- The web tsconfig must NOT inherit NodeNext: Vite uses bundler resolution and JSX. It extends the base but overrides `module`, `moduleResolution`, `jsx`, `lib`, and sets `noEmit` (Vite does the emitting).
- Vitest already globs `packages/*/tests/**/*.test.ts`. Component/api tests opt into jsdom per file with a `// @vitest-environment jsdom` docblock; pure-function tests stay in node env.
- The editor's value field accepts JSON; if `JSON.parse` fails the raw text is sent as a string (`parseEditValue`). The UI says so in a hint.
- After Task 1 the test suite is 69; Task 3 brings it to 76; Task 5 to 78. Core/server tests must stay green throughout.

---

### Task 1: Server — static SPA serving via `webRoot`

**Files:**
- Modify: `packages/server/package.json` (add `@fastify/static`)
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/bin.ts`
- Test: `packages/server/tests/static.test.ts`

- [ ] **Step 1: Add the dependency**

In `packages/server/package.json`, add to `dependencies`:

```json
    "@fastify/static": "^8.0.0",
```

Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`packages/server/tests/static.test.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'

const TOKEN = 't-test-token'

async function webRootFixture(): Promise<string> {
  const webRoot = await mkdtemp(join(tmpdir(), 'ccs-web-'))
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>CCS UI</title>')
  await mkdir(join(webRoot, 'assets'), { recursive: true })
  await writeFile(join(webRoot, 'assets', 'app.js'), 'console.log("ui")')
  return webRoot
}

describe('static web serving', () => {
  it('serves index.html at / when webRoot is provided', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CCS UI')
  })

  it('serves asset files', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('falls back to index.html for unknown non-API paths (SPA routes)', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/some/client/route' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CCS UI')
  })

  it('does not fall back for unknown /api paths', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({
      url: '/api/nope',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('not_found')
  })

  it('keeps the placeholder page when webRoot is absent', async () => {
    const app = buildServer({ token: TOKEN, webRoot: '/definitely/not/a/dir' })
    const res = await app.inject({ url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Claude Code Studio')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/static.test.ts`
Expected: FAIL — `webRoot` is not a `BuildOptions` field; `/` with webRoot still serves the placeholder; `/some/client/route` is 404.

- [ ] **Step 4: Implement**

In `packages/server/src/server.ts`:

Add imports at the top:
```ts
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
```

Add `webRoot` to `BuildOptions`:
```ts
export interface BuildOptions {
  token: string
  globalPaths?: GlobalPaths
  backupsRoot?: string
  /** Directory containing the built SPA (index.html + assets). Optional: without it a placeholder page is served. */
  webRoot?: string
}
```

Replace the `app.get('/', ...)` placeholder registration with:
```ts
  const webRoot = opts.webRoot
  if (webRoot && existsSync(join(webRoot, 'index.html'))) {
    void app.register(fastifyStatic, { root: webRoot })
    app.setNotFoundHandler((req, reply) => {
      // Fail-closed string check: an encoded /api path would merely get
      // index.html instead of a JSON 404 — auth never depends on this.
      if (req.method !== 'GET' || req.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.get('/', async (_req, reply) => {
      return reply
        .type('text/html')
        .send(
          '<!doctype html><html><body><h1>Claude Code Studio</h1><p>The web UI ships in a later milestone. The API is running.</p></body></html>',
        )
    })
  }
```

(`@fastify/static` calls the not-found handler when a wildcard-matched file does not exist, which is what makes the SPA fallback work.)

In `packages/server/src/bin.ts`, resolve the web bundle relative to the built bin and pass it through:

```ts
#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { createToken } from './config.js'
import { openBrowser } from './open-browser.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const token = createToken()
  // dist/bin.js → ../../../web/dist = packages/web/dist
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url))
  const app = buildServer({ token, webRoot })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const url = `${address}/#token=${token}`
  console.log(`\n  Claude Code Studio is running:\n\n    ${url}\n`)
  const opened = await openBrowser(url)
  if (!opened) {
    console.log('  Could not open a browser automatically — open the URL above manually.\n')
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
```

(Note: `new URL('../../web/dist', import.meta.url)` from `packages/server/dist/bin.js` resolves `..` → `dist`'s parent `server`, `../..` → `packages`, then `web/dist`. Correct.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: 69 tests pass (64 + 5). Then `npx tsc -p packages/server/tsconfig.json --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server package.json package-lock.json
git commit -m "feat(server): serve built web assets with SPA fallback via webRoot"
```

---

### Task 2: Scaffold `packages/web`

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles.css`
- Modify: root `package.json` (add `jsdom` devDependency)

- [ ] **Step 1: Create the package files**

`packages/web/package.json`:
```json
{
  "name": "@claude-code-studio/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json && vite build",
    "dev": "vite"
  },
  "dependencies": {
    "@fontsource/ibm-plex-mono": "^5.0.0",
    "@fontsource/instrument-serif": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^6.0.0"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "declaration": false,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`packages/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
})
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Code Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/main.tsx`:
```tsx
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/instrument-serif/400-italic.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`packages/web/src/App.tsx` (stub for this task; Task 4 replaces it):
```tsx
export function App() {
  return <h1 className="wordmark">Claude Code Studio</h1>
}
```

`packages/web/src/styles.css` (stub for this task; Task 4 replaces it):
```css
:root {
  color-scheme: dark;
}
body {
  background: #161210;
  color: #e8e0d2;
  font-family: 'IBM Plex Mono', monospace;
}
```

- [ ] **Step 2: Add jsdom for component tests**

In the root `package.json`, add to `devDependencies`:
```json
    "jsdom": "^26.0.0",
```

- [ ] **Step 3: Install and verify the build**

Run: `npm install && npm run build -w @claude-code-studio/web && ls packages/web/dist/index.html && npx vitest run`
Expected: Vite emits `packages/web/dist/` containing `index.html` + `assets/`; all 69 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web package.json package-lock.json
git commit -m "chore: scaffold web package with Vite, React, and bundled fonts"
```

---

### Task 3: API client, token bootstrap, and pure helpers (TDD)

**Files:**
- Create: `packages/web/src/api.ts`, `packages/web/src/utils.ts`
- Test: `packages/web/tests/api.test.ts`, `packages/web/tests/utils.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/web/tests/utils.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { diffLineKind, flattenLeaves, parseEditValue } from '../src/utils.js'

describe('flattenLeaves', () => {
  it('flattens nested objects to dotted paths with their sources', () => {
    const leaves = flattenLeaves(
      { model: 'opus', env: { FOO: '1' }, permissions: { allow: ['Read'] } },
      { model: 'user', 'env.FOO': 'projectLocal', 'permissions.allow': 'managed' },
    )
    expect(leaves).toEqual([
      { path: 'model', value: 'opus', source: 'user' },
      { path: 'env.FOO', value: '1', source: 'projectLocal' },
      { path: 'permissions.allow', value: ['Read'], source: 'managed' },
    ])
  })

  it('returns an empty list for empty settings', () => {
    expect(flattenLeaves({}, {})).toEqual([])
  })
})

describe('diffLineKind', () => {
  it('classifies unified diff lines', () => {
    expect(diffLineKind('+++ b/settings.json')).toBe('meta')
    expect(diffLineKind('--- a/settings.json')).toBe('meta')
    expect(diffLineKind('@@ -1,3 +1,4 @@')).toBe('meta')
    expect(diffLineKind('==='.repeat(3))).toBe('meta')
    expect(diffLineKind('Index: /x.json')).toBe('meta')
    expect(diffLineKind('+  "model": "sonnet"')).toBe('add')
    expect(diffLineKind('-  "model": "opus"')).toBe('del')
    expect(diffLineKind('   "env": {}')).toBe('ctx')
  })
})

describe('parseEditValue', () => {
  it('parses valid JSON', () => {
    expect(parseEditValue('true')).toBe(true)
    expect(parseEditValue('3')).toBe(3)
    expect(parseEditValue('{"a":1}')).toEqual({ a: 1 })
    expect(parseEditValue('"quoted"')).toBe('quoted')
  })

  it('falls back to the raw string for non-JSON', () => {
    expect(parseEditValue('sonnet')).toBe('sonnet')
  })
})
```

`packages/web/tests/api.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api, ApiError, bootstrapToken } from '../src/api.js'

function fakeWindow(hash: string) {
  const replaceState = vi.fn()
  return {
    location: { hash, pathname: '/', search: '' },
    sessionStorage: window.sessionStorage,
    history: { replaceState },
    replaceState,
  }
}

describe('bootstrapToken', () => {
  afterEach(() => window.sessionStorage.clear())

  it('reads the token from the fragment, stores it, and strips the hash', () => {
    const win = fakeWindow('#token=abc123')
    const token = bootstrapToken(win)
    expect(token).toBe('abc123')
    expect(window.sessionStorage.getItem('ccs-token')).toBe('abc123')
    expect(win.replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('falls back to sessionStorage when the hash is empty', () => {
    window.sessionStorage.setItem('ccs-token', 'stored')
    expect(bootstrapToken(fakeWindow(''))).toBe('stored')
  })

  it('returns null when no token exists anywhere', () => {
    expect(bootstrapToken(fakeWindow(''))).toBeNull()
  })
})

describe('Api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new Api('tok')
    const body = await api.health()
    expect(body).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init.headers.authorization).toBe('Bearer tok')
  })

  it('throws ApiError with status and body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'boom', code: 'WRITE_CONFLICT' }), { status: 409 }),
      ),
    )
    const api = new Api('tok')
    const err = await api.health().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).body.code).toBe('WRITE_CONFLICT')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests`
Expected: FAIL — modules `../src/utils.js` / `../src/api.js` don't exist.

- [ ] **Step 3: Implement**

`packages/web/src/utils.ts`:
```ts
import type { SettingsScope } from './api.js'

export interface Leaf {
  path: string
  value: unknown
  source?: SettingsScope
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Walk the effective settings object; scalars and arrays are leaves. */
export function flattenLeaves(
  value: Record<string, unknown>,
  sources: Record<string, SettingsScope>,
  prefix = '',
): Leaf[] {
  const leaves: Leaf[] = []
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(v)) {
      leaves.push(...flattenLeaves(v, sources, path))
    } else {
      leaves.push({ path, value: v, source: sources[path] })
    }
  }
  return leaves
}

export type DiffLineKind = 'meta' | 'add' | 'del' | 'ctx'

export function diffLineKind(line: string): DiffLineKind {
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('@@') ||
    line.startsWith('===') ||
    line.startsWith('Index')
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

/** Edit values are JSON; bare words fall back to plain strings. */
export function parseEditValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
```

`packages/web/src/api.ts`:
```ts
export type SettingsScope = 'user' | 'project' | 'projectLocal' | 'managed'

export interface JsonFileStateDto {
  path: string
  exists: boolean
  raw?: string
  hash?: string
  value?: Record<string, unknown>
  parseError?: string
}

export interface SettingsEntryDto {
  scope: SettingsScope
  editable: boolean
  state: JsonFileStateDto
}

export interface EffectiveDto {
  value: Record<string, unknown>
  sources: Record<string, SettingsScope>
}

export interface SettingsResponse {
  entries: SettingsEntryDto[]
  effective: EffectiveDto
}

export interface EditDto {
  path: string
  value?: unknown
  remove?: boolean
}

export interface PendingChangeDto {
  filePath: string
  before: string
  after: string
  diff: string
  expectedHash: string | null
  nextValue: Record<string, unknown>
}

export interface ApplyResponse {
  applied: boolean
  diff: string
}

export interface BackupEntryDto {
  backupPath: string
  originalPath: string
  timestamp: string
}

export interface HealthDto {
  ok: boolean
  cli: { found: boolean; version?: string }
}

const TOKEN_KEY = 'ccs-token'

interface Windowish {
  location: { hash: string; pathname: string; search: string }
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  history: { replaceState(data: unknown, unused: string, url: string): void }
}

/** Fragment → sessionStorage → stripped URL. Returns null when no token is available. */
export function bootstrapToken(win: Windowish): string | null {
  const match = win.location.hash.match(/token=([0-9a-zA-Z]+)/)
  if (match) {
    win.sessionStorage.setItem(TOKEN_KEY, match[1])
    win.history.replaceState(null, '', win.location.pathname + win.location.search)
  }
  return win.sessionStorage.getItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; code?: string },
  ) {
    super(body.error ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

interface ScopeTarget {
  scope: SettingsScope
  projectDir?: string
  edits: EditDto[]
}

export class Api {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      throw new ApiError(res.status, body)
    }
    return res.json() as Promise<T>
  }

  health(): Promise<HealthDto> {
    return this.request('/api/health')
  }

  settings(projectDir?: string): Promise<SettingsResponse> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/settings${q}`)
  }

  preview(target: ScopeTarget): Promise<PendingChangeDto> {
    return this.request('/api/settings/preview', { method: 'POST', body: JSON.stringify(target) })
  }

  apply(target: ScopeTarget & { expectedHash: string | null }): Promise<ApplyResponse> {
    return this.request('/api/settings/apply', { method: 'POST', body: JSON.stringify(target) })
  }

  backups(): Promise<{ backups: BackupEntryDto[] }> {
    return this.request('/api/backups')
  }

  restore(backupPath: string): Promise<{ restored: boolean; originalPath: string }> {
    return this.request('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ backupPath }),
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: 76 tests pass (69 + 7). Then `npx tsc -p packages/web/tsconfig.json --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/utils.ts packages/web/tests
git commit -m "feat(web): API client with token bootstrap and pure view helpers"
```

---

### Task 4: App shell + design system

**Files:**
- Modify: `packages/web/src/App.tsx` (replace), `packages/web/src/styles.css` (replace)
- Modify: `packages/web/src/main.tsx` (replace)
- Create: `packages/web/src/views/Dashboard.tsx`, `packages/web/src/views/Effective.tsx`, `packages/web/src/views/Editor.tsx`, `packages/web/src/views/Backups.tsx` (stubs — Tasks 5–7 fill them)

- [ ] **Step 1: Create the view stubs** (each view gets its real body in a later task; the shell needs the modules to exist now)

`packages/web/src/views/Dashboard.tsx`:
```tsx
import type { Api } from '../api.js'

export function Dashboard(_props: { api: Api; projectDir: string }) {
  return <p className="dim">Dashboard arrives in the next task.</p>
}
```

`packages/web/src/views/Effective.tsx`:
```tsx
import type { Api } from '../api.js'

export function Effective(_props: { api: Api; projectDir: string }) {
  return <p className="dim">Effective settings arrive in the next task.</p>
}
```

`packages/web/src/views/Editor.tsx`:
```tsx
import type { Api } from '../api.js'

export function Editor(_props: { api: Api; projectDir: string }) {
  return <p className="dim">The editor arrives in a later task.</p>
}
```

`packages/web/src/views/Backups.tsx`:
```tsx
import type { Api } from '../api.js'

export function Backups(_props: { api: Api }) {
  return <p className="dim">Backups arrive in a later task.</p>
}
```

- [ ] **Step 2: Replace `packages/web/src/App.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Api } from './api.js'
import { Backups } from './views/Backups.js'
import { Dashboard } from './views/Dashboard.js'
import { Editor } from './views/Editor.js'
import { Effective } from './views/Effective.js'

const VIEWS = [
  ['dashboard', 'Dashboard'],
  ['effective', 'Effective settings'],
  ['editor', 'Editor'],
  ['backups', 'Backups'],
] as const

type ViewKey = (typeof VIEWS)[number][0]

export function App({ token }: { token: string | null }) {
  const [view, setView] = useState<ViewKey>('dashboard')
  const [projectDir, setProjectDir] = useState(
    () => window.localStorage.getItem('ccs-project-dir') ?? '',
  )
  const api = useMemo(() => (token ? new Api(token) : null), [token])

  if (!api) {
    return (
      <main className="gate">
        <h1 className="wordmark">Claude Code Studio</h1>
        <p>
          No session token found. Start the app from your terminal with{' '}
          <code>npx claude-code-studio</code> and open the URL it prints — the token rides along in
          that URL.
        </p>
      </main>
    )
  }

  function updateProjectDir(value: string) {
    setProjectDir(value)
    window.localStorage.setItem('ccs-project-dir', value)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="wordmark">Claude Code Studio</h1>
        <nav>
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="project-dir">
          <span className="dim">Project directory (optional)</span>
          <input
            value={projectDir}
            placeholder="/path/to/project"
            onChange={(e) => updateProjectDir(e.target.value)}
          />
        </label>
      </aside>
      <main className="content">
        {view === 'dashboard' && <Dashboard api={api} projectDir={projectDir} />}
        {view === 'effective' && <Effective api={api} projectDir={projectDir} />}
        {view === 'editor' && <Editor api={api} projectDir={projectDir} />}
        {view === 'backups' && <Backups api={api} />}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Replace `packages/web/src/main.tsx`** (token bootstrap now wired)

```tsx
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/instrument-serif/400-italic.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapToken } from './api.js'
import { App } from './App.js'

const token = bootstrapToken(window)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App token={token} />
  </StrictMode>,
)
```

- [ ] **Step 4: Replace `packages/web/src/styles.css`** — the full design system:

```css
:root {
  color-scheme: dark;
  --bg: #161210;
  --bg-raised: #1f1a15;
  --bg-inset: #120f0c;
  --ink: #e8e0d2;
  --ink-dim: #9a8d79;
  --accent: #ffb454;
  --line: #352c22;
  --scope-user: #6fd0bd;
  --scope-project: #a3cf6b;
  --scope-projectLocal: #ffb454;
  --scope-managed: #e0705e;
  --diff-add: #a3cf6b;
  --diff-del: #e0705e;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --serif: 'Instrument Serif', serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 3px),
    radial-gradient(120% 90% at 20% 0%, #1c1611 0%, var(--bg) 55%);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.6;
  min-height: 100vh;
}

.wordmark {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  font-size: 1.7rem;
  letter-spacing: 0.01em;
  margin: 0 0 1.5rem;
  color: var(--ink);
}

.wordmark::after {
  content: '_';
  color: var(--accent);
}

.layout {
  display: grid;
  grid-template-columns: 250px 1fr;
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--line);
  padding: 2rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  font: inherit;
  text-align: left;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  color: var(--ink-dim);
  padding: 0.45rem 0.75rem;
  cursor: pointer;
}

.nav-item:hover {
  color: var(--ink);
}

.nav-item.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: var(--bg-raised);
}

.project-dir {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.78rem;
}

.content {
  padding: 2.5rem 3rem;
  max-width: 980px;
}

.content h2 {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  font-size: 1.6rem;
  margin: 0 0 1.5rem;
}

.dim {
  color: var(--ink-dim);
}

.gate {
  max-width: 32rem;
  margin: 18vh auto;
  padding: 0 2rem;
}

input,
select,
textarea {
  font: inherit;
  font-size: 0.85rem;
  color: var(--ink);
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 0.45rem 0.6rem;
}

input:focus,
select:focus,
textarea:focus {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

button.action {
  font: inherit;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--bg);
  background: var(--accent);
  border: none;
  border-radius: 3px;
  padding: 0.5rem 1.1rem;
  cursor: pointer;
}

button.action:disabled {
  opacity: 0.45;
  cursor: default;
}

button.ghost {
  font: inherit;
  font-size: 0.85rem;
  color: var(--ink-dim);
  background: none;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
}

button.ghost:hover {
  color: var(--ink);
  border-color: var(--ink-dim);
}

.badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid currentColor;
}

.badge.user { color: var(--scope-user); }
.badge.project { color: var(--scope-project); }
.badge.projectLocal { color: var(--scope-projectLocal); }
.badge.managed { color: var(--scope-managed); }

table.kv {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

table.kv th {
  text-align: left;
  color: var(--ink-dim);
  font-weight: 500;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.75rem;
}

table.kv td {
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.75rem;
  vertical-align: top;
}

table.kv td.path {
  color: var(--accent);
  white-space: nowrap;
}

table.kv td.value {
  word-break: break-all;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.card {
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1.1rem 1.25rem;
}

.card .label {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin-bottom: 0.35rem;
}

.card .figure {
  font-size: 1.5rem;
  font-weight: 600;
}

.card .figure.ok { color: var(--scope-project); }
.card .figure.bad { color: var(--scope-managed); }

pre.code,
pre.diff {
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-size: 0.82rem;
  line-height: 1.55;
}

pre.diff .add { color: var(--diff-add); }
pre.diff .del { color: var(--diff-del); }
pre.diff .meta { color: var(--ink-dim); }

.alert {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  background: var(--bg-raised);
  border-radius: 3px;
  padding: 0.7rem 1rem;
  margin: 1rem 0;
  font-size: 0.85rem;
}

.alert.error { border-left-color: var(--scope-managed); }
.alert.ok { border-left-color: var(--scope-project); }

.edit-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}

.toolbar {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin: 1.25rem 0;
}

.scope-picker {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1.25rem;
}

.scope-picker button {
  font: inherit;
  font-size: 0.8rem;
  background: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-dim);
  padding: 0.3rem 0.9rem;
  cursor: pointer;
}

.scope-picker button.active.user { color: var(--scope-user); border-color: var(--scope-user); }
.scope-picker button.active.project { color: var(--scope-project); border-color: var(--scope-project); }
.scope-picker button.active.projectLocal { color: var(--scope-projectLocal); border-color: var(--scope-projectLocal); }
```

- [ ] **Step 5: Verify**

Run: `npm run build -w @claude-code-studio/web && npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit`
Expected: build succeeds; 76 tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): app shell with sidebar nav, token gate, and design system"
```

---

### Task 5: Dashboard + Effective settings views

**Files:**
- Modify: `packages/web/src/views/Dashboard.tsx` (replace), `packages/web/src/views/Effective.tsx` (replace)
- Test: `packages/web/tests/effective.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/effective.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Effective } from '../src/views/Effective.js'

const SETTINGS = {
  entries: [],
  effective: {
    value: { model: 'sonnet', env: { FOO: '1' } },
    sources: { model: 'projectLocal', 'env.FOO': 'user' },
  },
}

describe('Effective view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders one row per leaf with its scope badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
    )
    render(<Effective api={new Api('t')} projectDir="" />)
    expect(await screen.findByText('model')).toBeDefined()
    expect(screen.getByText('env.FOO')).toBeDefined()
    expect(screen.getByText('projectLocal')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/effective.test.tsx`
Expected: FAIL — the stub renders placeholder text; no `model` row.

- [ ] **Step 3: Implement the Effective view** — replace `packages/web/src/views/Effective.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Api, SettingsResponse } from '../api.js'
import { flattenLeaves } from '../utils.js'

export function Effective({ api, projectDir }: { api: Api; projectDir: string }) {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="dim">Loading…</p>

  const leaves = flattenLeaves(data.effective.value, data.effective.sources)

  return (
    <>
      <h2>Effective settings</h2>
      <p className="dim">
        The merged result of every settings file, with the scope each value comes from.
      </p>
      {leaves.length === 0 ? (
        <p className="dim">No settings found.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map((leaf) => (
              <tr key={leaf.path}>
                <td className="path">{leaf.path}</td>
                <td className="value">{JSON.stringify(leaf.value)}</td>
                <td>
                  {leaf.source ? <span className={`badge ${leaf.source}`}>{leaf.source}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
```

- [ ] **Step 4: Implement the Dashboard** — replace `packages/web/src/views/Dashboard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Api, BackupEntryDto, HealthDto, SettingsResponse } from '../api.js'
import { flattenLeaves } from '../utils.js'

export function Dashboard({ api, projectDir }: { api: Api; projectDir: string }) {
  const [health, setHealth] = useState<HealthDto | null>(null)
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [backups, setBackups] = useState<BackupEntryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    Promise.all([api.health(), api.settings(projectDir || undefined), api.backups()])
      .then(([h, s, b]) => {
        setHealth(h)
        setSettings(s)
        setBackups(b.backups)
      })
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!health || !settings || !backups) return <p className="dim">Loading…</p>

  const present = settings.entries.filter((e) => e.state.exists)
  const broken = settings.entries.filter((e) => e.state.parseError)
  const keyCount = flattenLeaves(settings.effective.value, settings.effective.sources).length

  return (
    <>
      <h2>Dashboard</h2>
      <div className="cards">
        <div className="card">
          <div className="label">Claude CLI</div>
          <div className={health.cli.found ? 'figure ok' : 'figure bad'}>
            {health.cli.found ? (health.cli.version ?? 'found') : 'not found'}
          </div>
        </div>
        <div className="card">
          <div className="label">Settings files</div>
          <div className="figure">{present.length}</div>
        </div>
        <div className="card">
          <div className="label">Effective keys</div>
          <div className="figure">{keyCount}</div>
        </div>
        <div className="card">
          <div className="label">Backups</div>
          <div className="figure">{backups.length}</div>
        </div>
      </div>
      {broken.length > 0 && (
        <div className="alert error">
          {broken.length} settings file{broken.length > 1 ? 's' : ''} failed to parse:{' '}
          {broken.map((b) => b.state.path).join(', ')}
        </div>
      )}
      <h2>Files</h2>
      <table className="kv">
        <thead>
          <tr>
            <th>Scope</th>
            <th>File</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {settings.entries.map((entry) => (
            <tr key={entry.scope}>
              <td>
                <span className={`badge ${entry.scope}`}>{entry.scope}</span>
              </td>
              <td className="value">{entry.state.path}</td>
              <td className="dim">
                {entry.state.parseError
                  ? 'parse error'
                  : entry.state.exists
                    ? entry.editable
                      ? 'present'
                      : 'present (read-only)'
                    : 'absent'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: 77 tests pass (76 + 1); tsc clean; build green.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views packages/web/tests
git commit -m "feat(web): dashboard and effective settings views with scope badges"
```

---

### Task 6: Editor view (preview → apply)

**Files:**
- Modify: `packages/web/src/views/Editor.tsx` (replace)
- Test: `packages/web/tests/editor.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/editor.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Editor } from '../src/views/Editor.js'

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/home/u/.claude/settings.json', exists: true, raw: '{"model": "opus"}' },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

const PREVIEW = {
  filePath: '/home/u/.claude/settings.json',
  before: '{"model": "opus"}',
  after: '{\n  "model": "sonnet"\n}\n',
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n-{"model": "opus"}\n+  "model": "sonnet"',
  expectedHash: 'abc',
  nextValue: { model: 'sonnet' },
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/settings/preview')) {
      return Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(SETTINGS), { status: 200 }))
  })
}

describe('Editor view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the current file and previews a diff for an edit', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} projectDir="" />)
    expect(await screen.findByText('{"model": "opus"}')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('model or env.FOO'), {
      target: { value: 'model' },
    })
    fireEvent.change(screen.getByPlaceholderText('"sonnet" or {"a": 1} or plain text'), {
      target: { value: '"sonnet"' },
    })
    fireEvent.click(screen.getByText('Preview diff'))

    expect(await screen.findByText('+  "model": "sonnet"')).toBeDefined()
    expect(screen.getByText('Apply change')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/editor.test.tsx`
Expected: FAIL — stub view has no file display or inputs.

- [ ] **Step 3: Implement** — replace `packages/web/src/views/Editor.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type PendingChangeDto, type SettingsResponse } from '../api.js'
import { diffLineKind, parseEditValue } from '../utils.js'

const EDITABLE = ['user', 'project', 'projectLocal'] as const
type EditableScope = (typeof EDITABLE)[number]

interface EditRow {
  path: string
  value: string
  remove: boolean
}

const EMPTY_ROW: EditRow = { path: '', value: '', remove: false }

export function Editor({ api, projectDir }: { api: Api; projectDir: string }) {
  const [scope, setScope] = useState<EditableScope>('user')
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [rows, setRows] = useState<EditRow[]>([EMPTY_ROW])
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(() => {
    setData(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setMessage({ kind: 'error', text: e.message }))
  }, [api, projectDir])

  useEffect(() => {
    reload()
    setPending(null)
    setMessage(null)
  }, [reload])

  const needsProjectDir = scope !== 'user' && !projectDir
  const entry = data?.entries.find((e) => e.scope === scope)

  function buildEdits() {
    return rows
      .filter((r) => r.path.trim() !== '')
      .map((r) =>
        r.remove
          ? { path: r.path.trim(), remove: true }
          : { path: r.path.trim(), value: parseEditValue(r.value) },
      )
  }

  async function preview() {
    setMessage(null)
    setPending(null)
    try {
      const change = await api.preview({
        scope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
      })
      setPending(change)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function apply() {
    if (!pending) return
    setMessage(null)
    try {
      await api.apply({
        scope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
        expectedHash: pending.expectedHash,
      })
      setMessage({ kind: 'ok', text: 'Change applied. A backup of the previous file was kept.' })
      setPending(null)
      setRows([EMPTY_ROW])
      reload()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({
          kind: 'error',
          text: 'The file changed on disk since the preview — re-preview to see the current state.',
        })
        setPending(null)
        reload()
      } else {
        setMessage({ kind: 'error', text: (e as Error).message })
      }
    }
  }

  function updateRow(i: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setPending(null)
  }

  return (
    <>
      <h2>Editor</h2>
      <div className="scope-picker">
        {EDITABLE.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              setPending(null)
              setMessage(null)
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {needsProjectDir ? (
        <div className="alert">
          Set a project directory in the sidebar to edit project-scope settings.
        </div>
      ) : (
        <>
          <p className="dim">{entry ? entry.state.path : ''}</p>
          {entry?.state.parseError ? (
            <div className="alert error">
              This file is not valid JSON ({entry.state.parseError}). Fix it in your editor of
              choice — Studio refuses to write through a parse failure.
            </div>
          ) : (
            <>
              <pre className="code">{entry?.state.raw ?? '(file does not exist yet)'}</pre>

              <h2>Changes</h2>
              {rows.map((row, i) => (
                <div className="edit-row" key={i}>
                  <input
                    placeholder="model or env.FOO"
                    value={row.path}
                    onChange={(e) => updateRow(i, { path: e.target.value })}
                  />
                  <input
                    placeholder='"sonnet" or {"a": 1} or plain text'
                    value={row.value}
                    disabled={row.remove}
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                  />
                  <label className="dim">
                    <input
                      type="checkbox"
                      checked={row.remove}
                      onChange={(e) => updateRow(i, { remove: e.target.checked })}
                    />{' '}
                    remove
                  </label>
                  <button
                    className="ghost"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="toolbar">
                <button className="ghost" onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}>
                  + Add change
                </button>
                <button
                  className="action"
                  disabled={buildEdits().length === 0}
                  onClick={() => void preview()}
                >
                  Preview diff
                </button>
              </div>

              {pending && (
                <>
                  <pre className="diff">
                    {pending.diff.split('\n').map((line, i) => (
                      <div key={i} className={diffLineKind(line)}>
                        {line}
                      </div>
                    ))}
                  </pre>
                  <div className="toolbar">
                    <button className="action" onClick={() => void apply()}>
                      Apply change
                    </button>
                    <button className="ghost" onClick={() => setPending(null)}>
                      Discard
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: 78 tests pass (77 + 1); tsc clean; build green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Editor.tsx packages/web/tests/editor.test.tsx
git commit -m "feat(web): settings editor with dotted-path edits, diff preview, and conflict-aware apply"
```

---

### Task 7: Backups view

**Files:**
- Modify: `packages/web/src/views/Backups.tsx` (replace)

- [ ] **Step 1: Implement** — replace `packages/web/src/views/Backups.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Api, BackupEntryDto } from '../api.js'

export function Backups({ api }: { api: Api }) {
  const [backups, setBackups] = useState<BackupEntryDto[] | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(() => {
    api
      .backups()
      .then((b) => setBackups(b.backups))
      .catch((e: Error) => setMessage({ kind: 'error', text: e.message }))
  }, [api])

  useEffect(() => reload(), [reload])

  async function restore(entry: BackupEntryDto) {
    if (!window.confirm(`Restore this backup over ${entry.originalPath}?`)) return
    setMessage(null)
    try {
      await api.restore(entry.backupPath)
      setMessage({ kind: 'ok', text: `Restored ${entry.originalPath}` })
      reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  if (!backups) return <p className="dim">Loading…</p>

  return (
    <>
      <h2>Backups</h2>
      <p className="dim">
        Studio snapshots every file before changing it. Restore puts the snapshot back.
      </p>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      {backups.length === 0 ? (
        <p className="dim">No backups yet — they appear after your first applied change.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.backupPath}>
                <td className="dim">{b.timestamp}</td>
                <td className="value">{b.originalPath}</td>
                <td>
                  <button className="ghost" onClick={() => void restore(b)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: 78 tests pass; tsc clean; build green.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/Backups.tsx
git commit -m "feat(web): backups view with confirm-and-restore"
```

---

### Task 8: Full-flow verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Build everything and smoke-test the launcher**

```bash
npm run build
node packages/server/dist/bin.js &
sleep 2
# Capture the printed URL's port, then:
curl -s http://127.0.0.1:<port>/ | head -3       # expect the built SPA's index.html (contains /assets/)
curl -s http://127.0.0.1:<port>/api/health        # expect {"error":"unauthorized"}
kill %1
```

Expected: `/` serves the real SPA (look for `<script type="module" .../assets/...`), unauthenticated API still 401s.

- [ ] **Step 2: Update README**

Replace the status blockquote with:

```markdown
> Status: early development. The config engine (`packages/core`), the
> localhost API server + launcher (`packages/server`), and the web UI core
> (`packages/web` — dashboard, effective settings, editor with diff preview,
> backups) are done. Next up: MCP server and plugin management.
```

Replace the `- packages/web — (planned) React UI.` architecture line with:

```markdown
- `packages/web` — React + Vite SPA: dashboard, effective-settings view with
  per-scope source attribution, settings editor with diff preview/apply, and
  backup restore. Served by the local server; the session token travels in
  the launch URL fragment.
```

- [ ] **Step 3: Run the full suite one last time**

Run: `npx vitest run`
Expected: 78 tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README status update for web UI core"
```
