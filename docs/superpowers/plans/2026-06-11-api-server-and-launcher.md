# API Server + Launcher Implementation Plan (Plan ②)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@claude-code-studio/server` — a localhost-only, token-protected Fastify API over the core engine, plus the `claude-code-studio` bin that picks a random port, generates a session token, starts the server, and opens the browser.

**Architecture:** `buildServer(opts)` returns a Fastify instance (tests drive it with `app.inject()`, no real port). An `onRequest` hook enforces Host-header validation (anti DNS-rebinding), Origin rejection (no CORS), and bearer-token auth on `/api/*`. Routes are thin adapters over `@claude-code-studio/core`: settings read/effective, preview (diff), apply (re-plans server-side and verifies the previewed hash — the client never supplies a file path), backups list/restore. The bin is a thin untested glue file.

**Tech Stack:** Fastify ^5, TypeScript NodeNext ESM, Vitest (with a workspace alias so server tests run against core's TS source). Node ≥ 18.

**Plan sequence for v1** (this is Plan ②): ① core engine (done) → ② API server + npx launcher (this plan) → ③ web UI core → ④ MCP + plugins → ⑤ remaining editors.

**Carry-overs from Plan ①'s final review handled here (Tasks 1–2):** `exports` map on the core package, `WriteConflictError.code` discriminant for HTTP 409 mapping, `getBackupsRoot()` so server and UI agree on one canonical backups dir, `pruneBackups` wired into the apply flow, `maxBuffer` raised in `runCommand`. Deferred (documented, not forgotten): Windows `.cmd` shim for `detectCli`, `mtimeMs` on `JsonFileState` (wanted by Plan ③'s file watcher).

**Design notes the engineer must know:**
- The apply endpoint does NOT accept a `PendingChange` from the client. It takes `{scope, projectDir?, edits, expectedHash}`, re-plans server-side, and compares the recomputed `expectedHash` with the one the client previewed. This means the server only ever writes to settings files it resolved itself — a client can never name an arbitrary `filePath`.
- Restore is validated the same way: the client sends a `backupPath`, and the server only restores it if that exact path appears in its own `listBackups(backupsRoot)` listing.
- Security hooks run on every request: Host must be `127.0.0.1` or `localhost` (any port); an `Origin` header, when present, must also be one of those hosts; `/api/*` additionally requires `Authorization: Bearer <token>`. The `/` placeholder page is unauthenticated (it contains no secrets).
- Vitest resolves `@claude-code-studio/core` to core's TS source via an alias (no build needed for tests). `tsc` builds resolve it through the package `exports` map, so core must be built before type-checking server code: `npm run build -w @claude-code-studio/core`.

---

### Task 1: Core carry-overs — `exports` map + `WriteConflictError.code`

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/json-file.ts`
- Test: `packages/core/tests/json-file.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append inside the `writeJsonFileAtomic` describe block in `json-file.test.ts`)

```ts
  it('exposes a stable code on WriteConflictError for HTTP mapping', async () => {
    const dir = await tempDir()
    const file = join(dir, 'conflict-code.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    await writeFile(file, '{"v": 2}')
    const err = await writeJsonFileAtomic(file, { v: 3 }, { expectedHash: before.hash }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(WriteConflictError)
    expect((err as WriteConflictError).code).toBe('WRITE_CONFLICT')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: FAIL — `code` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/core/src/json-file.ts`, add the `code` field to `WriteConflictError`:

```ts
export class WriteConflictError extends Error {
  readonly code = 'WRITE_CONFLICT'

  constructor(public readonly filePath: string) {
    super(`File changed on disk since it was read: ${filePath}`)
    this.name = 'WriteConflictError'
  }
}
```

In `packages/core/package.json`, add an `exports` map after the `"types"` field:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/src/json-file.ts packages/core/tests/json-file.test.ts
git commit -m "feat(core): add exports map and stable WriteConflictError code"
```

---

### Task 2: Core carry-overs — `getBackupsRoot()` + `runCommand` maxBuffer

**Files:**
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/tests/paths.test.ts` (append), `packages/core/tests/cli.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/paths.test.ts` (add `getBackupsRoot` to the import from `../src/paths.js`):

```ts
describe('getBackupsRoot', () => {
  it('defaults to ~/.claude-code-studio/backups', () => {
    expect(getBackupsRoot('/Users/alice')).toBe('/Users/alice/.claude-code-studio/backups')
  })
})
```

Append inside the `runCommand` describe block in `packages/core/tests/cli.test.ts`:

```ts
  it('handles outputs larger than 1MB', async () => {
    const result = await runCommand('node', [
      '-e',
      "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBe(2 * 1024 * 1024)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/paths.test.ts packages/core/tests/cli.test.ts`
Expected: paths test FAILS (`getBackupsRoot` not exported); cli test FAILS (maxBuffer overflow throws).

- [ ] **Step 3: Implement**

Append to `packages/core/src/paths.ts`:

```ts
/** Canonical backups directory for Claude Code Studio itself (kept outside ~/.claude). */
export function getBackupsRoot(home: string = osHomedir()): string {
  return join(home, '.claude-code-studio', 'backups')
}
```

In `packages/core/src/cli.ts`, add `maxBuffer` to the options and pass it through (default 10 MB):

```ts
export async function runCommand(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CliRunResult> {
  const command = [bin, ...args].join(' ')
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    })
    return { command, exitCode: 0, stdout, stderr }
  } catch (err) {
    const e = err as Error & { code?: number | string; stdout?: string; stderr?: string }
    // e.code is a number only for normal process exits (e.g. exit(3)).
    // Timeouts (e.code === null, e.killed === true) and missing binaries
    // (e.code === 'ENOENT') both fail this guard and are re-thrown.
    if (typeof e.code === 'number') {
      return { command, exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
    throw err
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: 42 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/paths.ts packages/core/src/cli.ts packages/core/tests/paths.test.ts packages/core/tests/cli.test.ts
git commit -m "feat(core): canonical backups root and configurable runCommand maxBuffer"
```

---

### Task 3: Scaffold `packages/server`

**Files:**
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/index.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create the server package**

`packages/server/package.json`:
```json
{
  "name": "@claude-code-studio/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "claude-code-studio": "./dist/bin.js" },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@claude-code-studio/core": "^0.1.0",
    "fastify": "^5.0.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/server/src/index.ts`:
```ts
export {}
```

- [ ] **Step 2: Add the core source alias for Vitest**

Replace `vitest.config.ts` with:
```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@claude-code-studio/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Install and build core (needed for server type-checking)**

Run: `npm install && npm run build -w @claude-code-studio/core && npx vitest run`
Expected: fastify installed; core builds into `packages/core/dist/`; all 42 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold server package with core source alias for tests"
```

---

### Task 4: Auth hooks + health route + server skeleton

**Files:**
- Create: `packages/server/src/auth.ts`, `packages/server/src/routes/health.ts`, `packages/server/src/server.ts`
- Test: `packages/server/tests/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'

const TOKEN = 't-test-token'

function makeApp() {
  return buildServer({ token: TOKEN })
}

describe('auth and health', () => {
  it('rejects /api requests without a bearer token', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example.com', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects cross-origin requests', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example.com', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('accepts a same-origin Origin header', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://127.0.0.1:5555', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts authorized requests and reports health', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.cli.found).toBe('boolean')
  })

  it('serves the placeholder page without auth', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Claude Code Studio')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/auth.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Implement**

`packages/server/src/auth.ts`:
```ts
import type { FastifyInstance } from 'fastify'

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

/**
 * Localhost hardening, on every request:
 *  - Host header must be 127.0.0.1 or localhost (blocks DNS rebinding).
 *  - An Origin header, when present, must also be one of those hosts (no CORS).
 *  - /api/* additionally requires the per-session bearer token.
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (req, reply) => {
    const hostname = (req.headers.host ?? '').split(':')[0]
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'forbidden_host' })
    }
    const origin = req.headers.origin
    if (origin) {
      const originHost = safeOriginHostname(origin)
      if (!originHost || !ALLOWED_HOSTNAMES.has(originHost)) {
        return reply.code(403).send({ error: 'forbidden_origin' })
      }
    }
    if (req.url.startsWith('/api/') && req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })
}

function safeOriginHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}
```

`packages/server/src/routes/health.ts`:
```ts
import { detectCli } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'

export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    return { ok: true, cli: await detectCli() }
  })
}
```

`packages/server/src/server.ts`:
```ts
import { getBackupsRoot, getGlobalPaths, type GlobalPaths } from '@claude-code-studio/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.js'
import { healthRoutes } from './routes/health.js'

export interface BuildOptions {
  token: string
  globalPaths?: GlobalPaths
  backupsRoot?: string
}

export interface ServerContext {
  globalPaths: GlobalPaths
  backupsRoot: string
}

export function buildServer(opts: BuildOptions): FastifyInstance {
  const ctx: ServerContext = {
    globalPaths: opts.globalPaths ?? getGlobalPaths(),
    backupsRoot: opts.backupsRoot ?? getBackupsRoot(),
  }
  const app = Fastify({ logger: false })
  registerAuth(app, opts.token)
  app.get('/', async (_req, reply) => {
    return reply
      .type('text/html')
      .send(
        '<!doctype html><html><body><h1>Claude Code Studio</h1><p>The web UI ships in a later milestone. The API is running.</p></body></html>',
      )
  })
  healthRoutes(app)
  void ctx // settings/backups routes attach in later tasks
  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/tests/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): fastify skeleton with localhost hardening and health route"
```

---

### Task 5: Settings read route

**Files:**
- Create: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/settings-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/settings-routes.test.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths, getProjectPaths } from '@claude-code-studio/core'
import { buildServer } from '../src/server.js'

const TOKEN = 't-test-token'
const auth = { authorization: `Bearer ${TOKEN}` }

export async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ccs-srv-'))
  const globalPaths = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(globalPaths.configDir, { recursive: true })
  const backupsRoot = join(home, 'backups')
  const app = buildServer({ token: TOKEN, globalPaths, backupsRoot })
  return { home, globalPaths, backupsRoot, app }
}

describe('GET /api/settings', () => {
  it('returns entries and effective settings for the user scope', async () => {
    const { app, globalPaths } = await fixture()
    await writeFile(globalPaths.settings, '{"model": "opus"}')
    const res = await app.inject({ url: '/api/settings', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.entries.map((e: { scope: string }) => e.scope)).toEqual(['user', 'managed'])
    expect(body.effective.value.model).toBe('opus')
    expect(body.effective.sources.model).toBe('user')
  })

  it('includes project scopes when projectDir is given', async () => {
    const { app } = await fixture()
    const projectDir = await mkdtemp(join(tmpdir(), 'ccs-proj-'))
    const project = getProjectPaths(projectDir)
    await mkdir(join(projectDir, '.claude'), { recursive: true })
    await writeFile(project.settingsLocal, '{"model": "sonnet"}')
    const res = await app.inject({
      url: `/api/settings?projectDir=${encodeURIComponent(projectDir)}`,
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.entries.map((e: { scope: string }) => e.scope)).toEqual([
      'user',
      'project',
      'projectLocal',
      'managed',
    ])
    expect(body.effective.value.model).toBe('sonnet')
  })

  it('rejects a relative projectDir', async () => {
    const { app } = await fixture()
    const res = await app.inject({ url: '/api/settings?projectDir=foo', headers: auth })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/settings-routes.test.ts`
Expected: FAIL — cannot find module `../src/routes/settings.js` (after wiring) / 404 before wiring.

- [ ] **Step 3: Implement**

`packages/server/src/routes/settings.ts`:
```ts
import {
  getProjectPaths,
  readSettingsFiles,
  resolveEffectiveSettings,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

export async function readEntriesFor(ctx: ServerContext, projectDir?: string) {
  const project = projectDir ? getProjectPaths(projectDir) : undefined
  return readSettingsFiles(ctx.globalPaths, project)
}

export function settingsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/settings', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    const entries = await readEntriesFor(ctx, projectDir)
    return { entries, effective: resolveEffectiveSettings(entries) }
  })
}
```

In `packages/server/src/server.ts`: add `import { settingsRoutes } from './routes/settings.js'`, replace the `void ctx // settings/backups routes attach in later tasks` line with `settingsRoutes(app, ctx)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/tests/settings-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): settings read route with effective view"
```

---

### Task 6: Preview + apply routes

**Files:**
- Modify: `packages/server/src/routes/settings.ts`
- Test: `packages/server/tests/settings-routes.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `settings-routes.test.ts`; add `readFile` to the `node:fs/promises` import)

```ts
describe('POST /api/settings/preview and /apply', () => {
  it('previews a diff, then applies it with backup and prune', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.settings, '{"model": "opus"}')

    const preview = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'user', edits: [{ path: 'env.FOO', value: '1' }] },
    })
    expect(preview.statusCode).toBe(200)
    const change = preview.json()
    expect(change.diff).toContain('"FOO"')
    expect(typeof change.expectedHash).toBe('string')

    const apply = await app.inject({
      method: 'POST',
      url: '/api/settings/apply',
      headers: auth,
      payload: {
        scope: 'user',
        edits: [{ path: 'env.FOO', value: '1' }],
        expectedHash: change.expectedHash,
      },
    })
    expect(apply.statusCode).toBe(200)
    expect(apply.json().applied).toBe(true)

    const updated = JSON.parse(await readFile(globalPaths.settings, 'utf8'))
    expect(updated).toEqual({ model: 'opus', env: { FOO: '1' } })

    const { listBackups } = await import('@claude-code-studio/core')
    const onDisk = await listBackups(backupsRoot)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0].originalPath).toBe(globalPaths.settings)
  })

  it('returns 409 when the file changed after preview', async () => {
    const { app, globalPaths } = await fixture()
    await writeFile(globalPaths.settings, '{"model": "opus"}')
    const preview = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'user', edits: [{ path: 'model', value: 'sonnet' }] },
    })
    const { expectedHash } = preview.json()
    await writeFile(globalPaths.settings, '{"model": "haiku"}') // external change
    const apply = await app.inject({
      method: 'POST',
      url: '/api/settings/apply',
      headers: auth,
      payload: { scope: 'user', edits: [{ path: 'model', value: 'sonnet' }], expectedHash },
    })
    expect(apply.statusCode).toBe(409)
    expect(apply.json().code).toBe('WRITE_CONFLICT')
  })

  it('rejects the managed scope', async () => {
    const { app } = await fixture()
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'managed', edits: [{ path: 'model', value: 'x' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects project scopes without an absolute projectDir', async () => {
    const { app } = await fixture()
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'projectLocal', edits: [{ path: 'model', value: 'x' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects empty edits and forbidden paths', async () => {
    const { app } = await fixture()
    const empty = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'user', edits: [] },
    })
    expect(empty.statusCode).toBe(400)
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/settings/preview',
      headers: auth,
      payload: { scope: 'user', edits: [{ path: '__proto__.x', value: 1 }] },
    })
    expect(forbidden.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/settings-routes.test.ts`
Expected: new tests FAIL with 404 (routes don't exist).

- [ ] **Step 3: Implement** — replace `packages/server/src/routes/settings.ts` with:

```ts
import {
  applyChange,
  getProjectPaths,
  planJsonUpdate,
  pruneBackups,
  readSettingsFiles,
  resolveEffectiveSettings,
  WriteConflictError,
  type SettingsEdit,
  type SettingsScope,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

interface ScopeTargetBody {
  scope: SettingsScope
  projectDir?: string
  edits: SettingsEdit[]
}

const EDITABLE_SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'projectLocal'])

export async function readEntriesFor(ctx: ServerContext, projectDir?: string) {
  const project = projectDir ? getProjectPaths(projectDir) : undefined
  return readSettingsFiles(ctx.globalPaths, project)
}

function validateTarget(body: unknown): { error?: string; target?: ScopeTargetBody } {
  if (!body || typeof body !== 'object') return { error: 'invalid body' }
  const b = body as ScopeTargetBody
  if (!EDITABLE_SCOPES.has(b.scope)) return { error: `scope "${String(b.scope)}" is not editable` }
  if (b.scope !== 'user') {
    if (!b.projectDir) return { error: 'projectDir is required for project scopes' }
    if (!isAbsolute(b.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  if (!Array.isArray(b.edits) || b.edits.length === 0) {
    return { error: 'edits must be a non-empty array' }
  }
  return { target: b }
}

export function settingsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/settings', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    const entries = await readEntriesFor(ctx, projectDir)
    return { entries, effective: resolveEffectiveSettings(entries) }
  })

  app.post('/api/settings/preview', async (req, reply) => {
    const { error, target } = validateTarget(req.body)
    if (error) return reply.code(400).send({ error })
    const entries = await readEntriesFor(ctx, target!.projectDir)
    const entry = entries.find((e) => e.scope === target!.scope)!
    try {
      return planJsonUpdate(entry.state, target!.edits)
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.post<{ Body: { expectedHash: string | null } }>(
    '/api/settings/apply',
    async (req, reply) => {
      const { error, target } = validateTarget(req.body)
      if (error) return reply.code(400).send({ error })
      const entries = await readEntriesFor(ctx, target!.projectDir)
      const entry = entries.find((e) => e.scope === target!.scope)!
      let change
      try {
        change = planJsonUpdate(entry.state, target!.edits)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
      if (change.expectedHash !== req.body.expectedHash) {
        return reply
          .code(409)
          .send({ error: 'file changed since preview', code: 'WRITE_CONFLICT' })
      }
      try {
        const state = await applyChange(change, ctx.backupsRoot)
        await pruneBackups(ctx.backupsRoot)
        return { applied: true, state, diff: change.diff }
      } catch (err) {
        if (err instanceof WriteConflictError) {
          return reply.code(409).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/tests/settings-routes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): preview and apply routes with server-side replanning and 409 conflicts"
```

---

### Task 7: Backups routes

**Files:**
- Create: `packages/server/src/routes/backups.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/backups-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/backups-routes.test.ts`:
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { backupFile } from '@claude-code-studio/core'
import { fixture } from './settings-routes.test.js'

const TOKEN = 't-test-token'
const auth = { authorization: `Bearer ${TOKEN}` }

describe('backups routes', () => {
  it('lists backups newest-first', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.settings, '{"v": 1}')
    await backupFile(globalPaths.settings, backupsRoot)
    const res = await app.inject({ url: '/api/backups', headers: auth })
    expect(res.statusCode).toBe(200)
    const { backups } = res.json()
    expect(backups).toHaveLength(1)
    expect(backups[0].originalPath).toBe(globalPaths.settings)
  })

  it('restores a known backup and rejects unknown paths', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.settings, '{"v": 1}')
    const entry = await backupFile(globalPaths.settings, backupsRoot)
    await writeFile(globalPaths.settings, '{"v": 2}') // user breaks the file

    const ok = await app.inject({
      method: 'POST',
      url: '/api/backups/restore',
      headers: auth,
      payload: { backupPath: entry!.backupPath },
    })
    expect(ok.statusCode).toBe(200)
    expect(await readFile(globalPaths.settings, 'utf8')).toBe('{"v": 1}')

    const bad = await app.inject({
      method: 'POST',
      url: '/api/backups/restore',
      headers: auth,
      payload: { backupPath: '/etc/passwd' },
    })
    expect(bad.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/backups-routes.test.ts`
Expected: FAIL with 404 (routes don't exist).

- [ ] **Step 3: Implement**

`packages/server/src/routes/backups.ts`:
```ts
import { listBackups, restoreBackup } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server.js'

export function backupsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/backups', async () => {
    return { backups: await listBackups(ctx.backupsRoot) }
  })

  app.post<{ Body: { backupPath?: string } }>('/api/backups/restore', async (req, reply) => {
    const backupPath = req.body?.backupPath
    const all = await listBackups(ctx.backupsRoot)
    const entry = all.find((b) => b.backupPath === backupPath)
    if (!entry) return reply.code(404).send({ error: 'unknown backup' })
    await restoreBackup(entry)
    return { restored: true, originalPath: entry.originalPath }
  })
}
```

In `packages/server/src/server.ts`: add `import { backupsRoutes } from './routes/backups.js'` and call `backupsRoutes(app, ctx)` after `settingsRoutes(app, ctx)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/tests/backups-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): backups list and validated restore routes"
```

---

### Task 8: Launcher — token, browser opener, bin

**Files:**
- Create: `packages/server/src/config.ts`, `packages/server/src/open-browser.ts`, `packages/server/src/bin.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/tests/launcher.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/launcher.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createToken } from '../src/config.js'
import { browserCommand } from '../src/open-browser.js'

describe('createToken', () => {
  it('produces unique 64-char hex tokens', () => {
    const a = createToken()
    const b = createToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('browserCommand', () => {
  it('maps each platform to its opener', () => {
    const url = 'http://127.0.0.1:1234/#token=abc'
    expect(browserCommand(url, 'darwin')).toEqual({ bin: 'open', args: [url] })
    expect(browserCommand(url, 'linux')).toEqual({ bin: 'xdg-open', args: [url] })
    expect(browserCommand(url, 'win32')).toEqual({
      bin: 'cmd',
      args: ['/c', 'start', '', url],
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/launcher.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

`packages/server/src/config.ts`:
```ts
import { randomBytes } from 'node:crypto'

/** Per-session bearer token, delivered to the browser via the launch URL fragment. */
export function createToken(): string {
  return randomBytes(32).toString('hex')
}
```

`packages/server/src/open-browser.ts`:
```ts
import { runCommand } from '@claude-code-studio/core'

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { bin: string; args: string[] } {
  if (platform === 'darwin') return { bin: 'open', args: [url] }
  if (platform === 'win32') return { bin: 'cmd', args: ['/c', 'start', '', url] }
  return { bin: 'xdg-open', args: [url] }
}

/** Best-effort: returns false instead of throwing when no opener is available. */
export async function openBrowser(url: string): Promise<boolean> {
  const { bin, args } = browserCommand(url)
  try {
    const result = await runCommand(bin, args, { timeoutMs: 5_000 })
    return result.exitCode === 0
  } catch {
    return false
  }
}
```

`packages/server/src/bin.ts`:
```ts
#!/usr/bin/env node
import { createToken } from './config.js'
import { openBrowser } from './open-browser.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const token = createToken()
  const app = buildServer({ token })
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

Replace `packages/server/src/index.ts` with:
```ts
export { buildServer, type BuildOptions, type ServerContext } from './server.js'
export { createToken } from './config.js'
export { browserCommand, openBrowser } from './open-browser.js'
```

- [ ] **Step 4: Run tests and type-check both packages**

Run: `npx vitest run && npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: all tests pass; tsc clean (core was built in Task 3; if `dist` is missing run `npm run build -w @claude-code-studio/core` first).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): npx launcher with session token and browser opener"
```

---

### Task 9: End-to-end test over real HTTP + README update

**Files:**
- Test: `packages/server/tests/e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the e2e test (no red phase — this is an integration test over built behavior)**

`packages/server/tests/e2e.test.ts`:
```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths } from '@claude-code-studio/core'
import { createToken } from '../src/config.js'
import { buildServer } from '../src/server.js'

describe('e2e over real HTTP', () => {
  it('boots on an ephemeral port and serves the full preview/apply/restore flow', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccs-e2e-'))
    const globalPaths = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
    await mkdir(globalPaths.configDir, { recursive: true })
    await writeFile(globalPaths.settings, '{"model": "opus"}')
    const backupsRoot = join(home, 'backups')
    const token = createToken()
    const app = buildServer({ token, globalPaths, backupsRoot })
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    try {
      // no token → 401
      const noAuth = await fetch(`${address}/api/health`)
      expect(noAuth.status).toBe(401)

      // health
      const health = await fetch(`${address}/api/health`, { headers: auth })
      expect(health.status).toBe(200)

      // preview → apply
      const preview = await fetch(`${address}/api/settings/preview`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ scope: 'user', edits: [{ path: 'model', value: 'sonnet' }] }),
      })
      expect(preview.status).toBe(200)
      const { expectedHash } = (await preview.json()) as { expectedHash: string }
      const apply = await fetch(`${address}/api/settings/apply`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          scope: 'user',
          edits: [{ path: 'model', value: 'sonnet' }],
          expectedHash,
        }),
      })
      expect(apply.status).toBe(200)
      expect(JSON.parse(await readFile(globalPaths.settings, 'utf8'))).toEqual({ model: 'sonnet' })

      // backups → restore
      const backups = await fetch(`${address}/api/backups`, { headers: auth })
      const { backups: list } = (await backups.json()) as {
        backups: Array<{ backupPath: string }>
      }
      expect(list).toHaveLength(1)
      const restore = await fetch(`${address}/api/backups/restore`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ backupPath: list[0].backupPath }),
      })
      expect(restore.status).toBe(200)
      expect(JSON.parse(await readFile(globalPaths.settings, 'utf8'))).toEqual({ model: 'opus' })
    } finally {
      await app.close()
    }
  })
})
```

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (61 total: 42 core + 19 server).

- [ ] **Step 3: Update README status**

In `README.md`, replace the status blockquote with:

```markdown
> Status: early development. The config engine (`packages/core`) and the
> localhost API server + launcher (`packages/server`) are done; the web UI
> is next. See `docs/superpowers/specs/` for the design and
> `docs/superpowers/plans/` for implementation plans.
```

And in the Architecture section, change the server line to:

```markdown
- `packages/server` — localhost-only Fastify API + `claude-code-studio` bin.
  Token-protected, Host/Origin validated, random port per session.
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/tests/e2e.test.ts README.md
git commit -m "test(server): end-to-end HTTP flow and README status update"
```
