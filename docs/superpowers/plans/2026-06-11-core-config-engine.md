# Core Config Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@claude-code-studio/core` — the pure-Node config engine that reads, resolves, diffs, backs up, and safely writes every Claude Code settings file.

**Architecture:** npm-workspaces monorepo. This plan builds only `packages/core`: path discovery → safe JSON read/atomic write with conflict detection → backups → multi-scope settings reads → precedence resolver → surgical edits with diff preview → CLI runner. Later plans add `packages/server` (Fastify API + npx launcher) and `packages/web` (React UI).

**Tech Stack:** TypeScript (strict, NodeNext ESM), Vitest, `diff` package. Node ≥ 18. No other runtime dependencies.

**Plan sequence for v1** (this is Plan 1): ① core engine (this plan) → ② API server + npx launcher → ③ web UI core (dashboard, effective settings, settings editor) → ④ MCP + plugins management → ⑤ remaining editors (hooks, agents/skills/CLAUDE.md, keybindings).

**Design notes the engineer must know:**
- Claude Code settings precedence, lowest → highest: user (`~/.claude/settings.json`) → project (`.claude/settings.json`) → project-local (`.claude/settings.local.json`) → managed (enterprise, read-only).
- `CLAUDE_CONFIG_DIR` env var relocates `~/.claude` AND `~/.claude.json` (to `$CLAUDE_CONFIG_DIR/.claude.json`). All path logic takes injected `env`/`platform`/`home` parameters so tests never touch the real home directory.
- Known v1 simplification: the precedence resolver replaces arrays wholesale (it does not union `permissions.allow` across scopes the way Claude Code does at runtime). The UI will show per-scope values; revisit in Plan ③.
- Surgical edits work on the parsed object and only touch the targeted dotted paths — unknown keys survive untouched. Formatting is normalized to 2-space JSON; that is acceptable because these files are machine-written JSON.
- Every write: diff preview first (`planJsonUpdate`), then `applyChange` = re-check hash → backup → write-to-temp → atomic rename.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

- [ ] **Step 1: Create root files**

`.gitignore`:
```
node_modules/
dist/
.DS_Store
```

`package.json`:
```json
{
  "name": "claude-code-studio-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run",
    "build": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Create the core package**

`packages/core/package.json`:
```json
{
  "name": "@claude-code-studio/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "diff": "^7.0.0" },
  "devDependencies": { "@types/diff": "^7.0.0" }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/core/src/index.ts`:
```ts
export {}
```

- [ ] **Step 3: Install and verify the test runner works**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: install succeeds; vitest reports "No test files found" and exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm-workspaces monorepo with core package"
```

---

### Task 2: Config path discovery (`paths.ts`)

**Files:**
- Create: `packages/core/src/paths.ts`
- Test: `packages/core/tests/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { getGlobalPaths, getProjectPaths } from '../src/paths.js'

describe('getGlobalPaths', () => {
  it('defaults to ~/.claude and ~/.claude.json', () => {
    const p = getGlobalPaths({}, 'darwin', '/Users/alice')
    expect(p.configDir).toBe('/Users/alice/.claude')
    expect(p.settings).toBe('/Users/alice/.claude/settings.json')
    expect(p.claudeJson).toBe('/Users/alice/.claude.json')
    expect(p.keybindings).toBe('/Users/alice/.claude/keybindings.json')
  })

  it('honors CLAUDE_CONFIG_DIR for the config dir and .claude.json', () => {
    const p = getGlobalPaths({ CLAUDE_CONFIG_DIR: '/tmp/cc' }, 'linux', '/home/alice')
    expect(p.configDir).toBe('/tmp/cc')
    expect(p.settings).toBe('/tmp/cc/settings.json')
    expect(p.claudeJson).toBe('/tmp/cc/.claude.json')
  })

  it('returns the platform-specific managed settings path', () => {
    expect(getGlobalPaths({}, 'darwin', '/Users/a').managedSettings).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    )
    expect(getGlobalPaths({}, 'linux', '/home/a').managedSettings).toBe(
      '/etc/claude-code/managed-settings.json',
    )
    expect(getGlobalPaths({}, 'win32', 'C:\\Users\\a').managedSettings).toBe(
      'C:\\ProgramData\\ClaudeCode\\managed-settings.json',
    )
  })
})

describe('getProjectPaths', () => {
  it('maps all project-scope files under the project dir', () => {
    const p = getProjectPaths('/work/app')
    expect(p.settings).toBe('/work/app/.claude/settings.json')
    expect(p.settingsLocal).toBe('/work/app/.claude/settings.local.json')
    expect(p.mcpJson).toBe('/work/app/.mcp.json')
    expect(p.claudeMd).toBe('/work/app/CLAUDE.md')
    expect(p.agentsDir).toBe('/work/app/.claude/agents')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/paths.test.ts`
Expected: FAIL — cannot find module `../src/paths.js`.

- [ ] **Step 3: Implement `paths.ts`**

`packages/core/src/paths.ts`:
```ts
import { homedir as osHomedir } from 'node:os'
import { join } from 'node:path'

export interface GlobalPaths {
  configDir: string
  settings: string
  claudeJson: string
  keybindings: string
  claudeMd: string
  agentsDir: string
  skillsDir: string
  pluginsDir: string
  managedSettings: string
}

export function getGlobalPaths(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = osHomedir(),
): GlobalPaths {
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(home, '.claude')
  const claudeJson = env.CLAUDE_CONFIG_DIR
    ? join(configDir, '.claude.json')
    : join(home, '.claude.json')
  return {
    configDir,
    settings: join(configDir, 'settings.json'),
    claudeJson,
    keybindings: join(configDir, 'keybindings.json'),
    claudeMd: join(configDir, 'CLAUDE.md'),
    agentsDir: join(configDir, 'agents'),
    skillsDir: join(configDir, 'skills'),
    pluginsDir: join(configDir, 'plugins'),
    managedSettings: managedSettingsPath(platform),
  }
}

function managedSettingsPath(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json'
  }
  if (platform === 'win32') {
    return 'C:\\ProgramData\\ClaudeCode\\managed-settings.json'
  }
  return '/etc/claude-code/managed-settings.json'
}

export interface ProjectPaths {
  projectDir: string
  settings: string
  settingsLocal: string
  mcpJson: string
  claudeMd: string
  agentsDir: string
  skillsDir: string
}

export function getProjectPaths(projectDir: string): ProjectPaths {
  const dotClaude = join(projectDir, '.claude')
  return {
    projectDir,
    settings: join(dotClaude, 'settings.json'),
    settingsLocal: join(dotClaude, 'settings.local.json'),
    mcpJson: join(projectDir, '.mcp.json'),
    claudeMd: join(projectDir, 'CLAUDE.md'),
    agentsDir: join(dotClaude, 'agents'),
    skillsDir: join(dotClaude, 'skills'),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/paths.test.ts`
Expected: PASS (6 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/paths.ts packages/core/tests/paths.test.ts
git commit -m "feat(core): config path discovery for global and project scopes"
```

---

### Task 3: Safe JSON reading (`json-file.ts`, read side)

**Files:**
- Create: `packages/core/src/json-file.ts`
- Test: `packages/core/tests/json-file.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/json-file.test.ts`:
```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonFile } from '../src/json-file.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ccs-json-'))
}

describe('readJsonFile', () => {
  it('reports a missing file without throwing', async () => {
    const dir = await tempDir()
    const state = await readJsonFile(join(dir, 'nope.json'))
    expect(state.exists).toBe(false)
    expect(state.value).toBeUndefined()
  })

  it('parses valid JSON and computes a content hash', async () => {
    const dir = await tempDir()
    const file = join(dir, 'ok.json')
    await writeFile(file, '{"a": 1}')
    const state = await readJsonFile<{ a: number }>(file)
    expect(state.exists).toBe(true)
    expect(state.value?.a).toBe(1)
    expect(state.raw).toBe('{"a": 1}')
    expect(state.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.parseError).toBeUndefined()
  })

  it('surfaces parse errors but preserves the raw content', async () => {
    const dir = await tempDir()
    const file = join(dir, 'bad.json')
    await writeFile(file, '{oops')
    const state = await readJsonFile(file)
    expect(state.exists).toBe(true)
    expect(state.parseError).toBeTruthy()
    expect(state.value).toBeUndefined()
    expect(state.raw).toBe('{oops')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: FAIL — cannot find module `../src/json-file.js`.

- [ ] **Step 3: Implement the read side**

`packages/core/src/json-file.ts`:
```ts
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export interface JsonFileState<T = unknown> {
  path: string
  exists: boolean
  raw?: string
  /** sha256 hex of raw content; used for write-conflict detection */
  hash?: string
  value?: T
  parseError?: string
}

export function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function readJsonFile<T = unknown>(path: string): Promise<JsonFileState<T>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, exists: false }
    }
    throw err
  }
  const state: JsonFileState<T> = { path, exists: true, raw, hash: hashContent(raw) }
  try {
    state.value = JSON.parse(raw) as T
  } catch (err) {
    state.parseError = (err as Error).message
  }
  return state
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/json-file.ts packages/core/tests/json-file.test.ts
git commit -m "feat(core): safe JSON file reading with hash and parse-error capture"
```

---

### Task 4: Atomic writes with conflict detection (`json-file.ts`, write side)

**Files:**
- Modify: `packages/core/src/json-file.ts`
- Test: `packages/core/tests/json-file.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `json-file.test.ts`)

```ts
import { readFile } from 'node:fs/promises'
import { WriteConflictError, writeJsonFileAtomic } from '../src/json-file.js'

describe('writeJsonFileAtomic', () => {
  it('writes pretty JSON, creating parent directories', async () => {
    const dir = await tempDir()
    const file = join(dir, 'deep', 'nested', 'new.json')
    const state = await writeJsonFileAtomic(file, { b: 2 })
    expect(state.raw).toBe('{\n  "b": 2\n}\n')
    expect(await readFile(file, 'utf8')).toBe('{\n  "b": 2\n}\n')
  })

  it('throws WriteConflictError when the file changed since it was read', async () => {
    const dir = await tempDir()
    const file = join(dir, 'c.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    await writeFile(file, '{"v": 999}') // external change
    await expect(
      writeJsonFileAtomic(file, { v: 2 }, { expectedHash: before.hash }),
    ).rejects.toBeInstanceOf(WriteConflictError)
  })

  it('throws WriteConflictError when expecting no file but one exists', async () => {
    const dir = await tempDir()
    const file = join(dir, 'd.json')
    await writeFile(file, '{}')
    await expect(
      writeJsonFileAtomic(file, { v: 1 }, { expectedHash: null }),
    ).rejects.toBeInstanceOf(WriteConflictError)
  })

  it('writes when the expected hash matches', async () => {
    const dir = await tempDir()
    const file = join(dir, 'e.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    const after = await writeJsonFileAtomic(file, { v: 2 }, { expectedHash: before.hash })
    expect(after.value).toEqual({ v: 2 })
  })
})
```

Merge the new imports into the existing import lines at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: FAIL — `writeJsonFileAtomic` is not exported.

- [ ] **Step 3: Implement the write side** (append to `json-file.ts`)

```ts
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class WriteConflictError extends Error {
  constructor(public readonly filePath: string) {
    super(`File changed on disk since it was read: ${filePath}`)
    this.name = 'WriteConflictError'
  }
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

/**
 * expectedHash semantics:
 *  - undefined: skip the conflict check
 *  - null: caller expects the file not to exist yet
 *  - string: caller expects current content to hash to this value
 */
export async function writeJsonFileAtomic<T>(
  path: string,
  value: T,
  opts: { expectedHash?: string | null } = {},
): Promise<JsonFileState<T>> {
  if (opts.expectedHash !== undefined) {
    const current = await readJsonFile(path)
    const currentHash = current.exists ? current.hash! : null
    if (currentHash !== opts.expectedHash) {
      throw new WriteConflictError(path)
    }
  }
  const raw = serializeJson(value)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, raw, 'utf8')
  await rename(tmp, path)
  return { path, exists: true, raw, hash: hashContent(raw), value }
}
```

Merge the `node:fs/promises` import with the existing one at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/json-file.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/json-file.ts packages/core/tests/json-file.test.ts
git commit -m "feat(core): atomic JSON writes with hash-based conflict detection"
```

---

### Task 5: Backups (`backups.ts`)

**Files:**
- Create: `packages/core/src/backups.ts`
- Test: `packages/core/tests/backups.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/backups.test.ts`:
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupFile, listBackups, pruneBackups, restoreBackup } from '../src/backups.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ccs-bak-'))
  return { dir, backupsRoot: join(dir, 'backups') }
}

describe('backups', () => {
  it('returns null when the original file does not exist', async () => {
    const { dir, backupsRoot } = await setup()
    expect(await backupFile(join(dir, 'nope.json'), backupsRoot)).toBeNull()
  })

  it('creates a backup, lists it newest-first, and restores it', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{"v": 1}')
    const entry = await backupFile(file, backupsRoot)
    expect(entry?.originalPath).toBe(file)

    await writeFile(file, '{"v": 2}') // user breaks the file
    const [listed] = await listBackups(backupsRoot)
    expect(listed.originalPath).toBe(file)
    await restoreBackup(listed)
    expect(await readFile(file, 'utf8')).toBe('{"v": 1}')
  })

  it('prunes old backups, keeping the newest N per original file', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 'a.json')
    await writeFile(file, '{"v": 1}')
    await backupFile(file, backupsRoot)
    await sleep(10)
    await writeFile(file, '{"v": 2}')
    await backupFile(file, backupsRoot)
    await sleep(10)
    await writeFile(file, '{"v": 3}')
    await backupFile(file, backupsRoot)

    const removed = await pruneBackups(backupsRoot, 1)
    expect(removed).toBe(2)
    const remaining = await listBackups(backupsRoot)
    expect(remaining).toHaveLength(1)
    expect(await readFile(remaining[0].backupPath, 'utf8')).toBe('{"v": 3}')
  })

  it('lists nothing for a missing backups root', async () => {
    const { dir } = await setup()
    expect(await listBackups(join(dir, 'no-such-root'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/backups.test.ts`
Expected: FAIL — cannot find module `../src/backups.js`.

- [ ] **Step 3: Implement `backups.ts`**

`packages/core/src/backups.ts`:
```ts
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface BackupEntry {
  backupPath: string
  originalPath: string
  /** filesystem-safe ISO timestamp, e.g. 2026-06-11T12-30-00-000Z */
  timestamp: string
}

function timestampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Backup file name format: `<timestamp>__<encodeURIComponent(originalPath)>` */
export async function backupFile(
  originalPath: string,
  backupsRoot: string,
): Promise<BackupEntry | null> {
  try {
    await stat(originalPath)
  } catch {
    return null
  }
  await mkdir(backupsRoot, { recursive: true })
  const timestamp = timestampNow()
  const backupPath = join(backupsRoot, `${timestamp}__${encodeURIComponent(originalPath)}`)
  await copyFile(originalPath, backupPath)
  return { backupPath, originalPath, timestamp }
}

export async function listBackups(backupsRoot: string): Promise<BackupEntry[]> {
  let names: string[]
  try {
    names = await readdir(backupsRoot)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    const sep = name.indexOf('__')
    if (sep === -1) continue
    entries.push({
      backupPath: join(backupsRoot, name),
      timestamp: name.slice(0, sep),
      originalPath: decodeURIComponent(name.slice(sep + 2)),
    })
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export async function restoreBackup(entry: BackupEntry): Promise<void> {
  await copyFile(entry.backupPath, entry.originalPath)
}

export async function pruneBackups(backupsRoot: string, keepPerFile = 20): Promise<number> {
  const all = await listBackups(backupsRoot)
  const byOriginal = new Map<string, BackupEntry[]>()
  for (const entry of all) {
    const list = byOriginal.get(entry.originalPath) ?? []
    list.push(entry)
    byOriginal.set(entry.originalPath, list)
  }
  let removed = 0
  for (const list of byOriginal.values()) {
    for (const stale of list.slice(keepPerFile)) {
      await rm(stale.backupPath)
      removed++
    }
  }
  return removed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/backups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/backups.ts packages/core/tests/backups.test.ts
git commit -m "feat(core): timestamped file backups with restore and pruning"
```

---

### Task 6: Multi-scope settings reads (`settings.ts`)

**Files:**
- Create: `packages/core/src/settings.ts`
- Test: `packages/core/tests/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/settings.test.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths, getProjectPaths } from '../src/paths.js'
import { readSettingsFiles } from '../src/settings.js'

describe('readSettingsFiles', () => {
  it('reads user + managed scopes when no project is given', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccs-home-'))
    const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
    await mkdir(global.configDir, { recursive: true })
    await writeFile(global.settings, '{"model": "opus"}')

    const entries = await readSettingsFiles(global)
    expect(entries.map((e) => e.scope)).toEqual(['user', 'managed'])
    const user = entries.find((e) => e.scope === 'user')!
    expect(user.editable).toBe(true)
    expect(user.state.value).toEqual({ model: 'opus' })
    const managed = entries.find((e) => e.scope === 'managed')!
    expect(managed.editable).toBe(false)
  })

  it('includes project and projectLocal scopes when a project is given', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccs-home-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'ccs-proj-'))
    const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
    const project = getProjectPaths(projectDir)
    await mkdir(join(projectDir, '.claude'), { recursive: true })
    await writeFile(project.settingsLocal, '{"model": "sonnet"}')

    const entries = await readSettingsFiles(global, project)
    expect(entries.map((e) => e.scope)).toEqual(['user', 'project', 'projectLocal', 'managed'])
    const local = entries.find((e) => e.scope === 'projectLocal')!
    expect(local.state.value).toEqual({ model: 'sonnet' })
    const proj = entries.find((e) => e.scope === 'project')!
    expect(proj.state.exists).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/settings.test.ts`
Expected: FAIL — cannot find module `../src/settings.js`.

- [ ] **Step 3: Implement `settings.ts`**

`packages/core/src/settings.ts`:
```ts
import { readJsonFile, type JsonFileState } from './json-file.js'
import type { GlobalPaths, ProjectPaths } from './paths.js'

export type SettingsScope = 'user' | 'project' | 'projectLocal' | 'managed'

/** Lowest to highest precedence. */
export const SCOPE_ORDER: SettingsScope[] = ['user', 'project', 'projectLocal', 'managed']

export interface SettingsFileEntry {
  scope: SettingsScope
  /** Managed (enterprise) settings are shown read-only. */
  editable: boolean
  state: JsonFileState<Record<string, unknown>>
}

export async function readSettingsFiles(
  global: GlobalPaths,
  project?: ProjectPaths,
): Promise<SettingsFileEntry[]> {
  const entries: SettingsFileEntry[] = [
    { scope: 'user', editable: true, state: await readJsonFile(global.settings) },
  ]
  if (project) {
    entries.push(
      { scope: 'project', editable: true, state: await readJsonFile(project.settings) },
      { scope: 'projectLocal', editable: true, state: await readJsonFile(project.settingsLocal) },
    )
  }
  entries.push({
    scope: 'managed',
    editable: false,
    state: await readJsonFile(global.managedSettings),
  })
  return entries
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings.ts packages/core/tests/settings.test.ts
git commit -m "feat(core): read settings files across user, project, and managed scopes"
```

---

### Task 7: Effective-settings resolver (`precedence.ts`)

**Files:**
- Create: `packages/core/src/precedence.ts`
- Test: `packages/core/tests/precedence.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/precedence.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { SettingsFileEntry } from '../src/settings.js'
import { resolveEffectiveSettings } from '../src/precedence.js'

function entry(
  scope: SettingsFileEntry['scope'],
  value: Record<string, unknown> | undefined,
): SettingsFileEntry {
  return {
    scope,
    editable: scope !== 'managed',
    state: { path: `/fake/${scope}.json`, exists: value !== undefined, value },
  }
}

describe('resolveEffectiveSettings', () => {
  it('merges scopes lowest-to-highest and records the winning source per leaf', () => {
    const result = resolveEffectiveSettings([
      entry('user', { model: 'opus', env: { FOO: '1', BAR: '2' } }),
      entry('project', undefined),
      entry('projectLocal', { env: { BAR: '3' } }),
      entry('managed', { model: 'sonnet' }),
    ])
    expect(result.value).toEqual({ model: 'sonnet', env: { FOO: '1', BAR: '3' } })
    expect(result.sources['model']).toBe('managed')
    expect(result.sources['env.FOO']).toBe('user')
    expect(result.sources['env.BAR']).toBe('projectLocal')
  })

  it('replaces arrays wholesale (documented v1 simplification)', () => {
    const result = resolveEffectiveSettings([
      entry('user', { permissions: { allow: ['Bash(ls:*)'] } }),
      entry('projectLocal', { permissions: { allow: ['Read'] } }),
      entry('managed', undefined),
    ])
    expect(result.value).toEqual({ permissions: { allow: ['Read'] } })
    expect(result.sources['permissions.allow']).toBe('projectLocal')
  })

  it('returns empty settings when no file exists', () => {
    const result = resolveEffectiveSettings([entry('user', undefined), entry('managed', undefined)])
    expect(result.value).toEqual({})
    expect(result.sources).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/precedence.test.ts`
Expected: FAIL — cannot find module `../src/precedence.js`.

- [ ] **Step 3: Implement `precedence.ts`**

`packages/core/src/precedence.ts`:
```ts
import { SCOPE_ORDER, type SettingsFileEntry, type SettingsScope } from './settings.js'

export interface EffectiveSettings {
  value: Record<string, unknown>
  /** dotted leaf path (e.g. "env.FOO") -> scope that supplied the winning value */
  sources: Record<string, SettingsScope>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function resolveEffectiveSettings(entries: SettingsFileEntry[]): EffectiveSettings {
  const value: Record<string, unknown> = {}
  const sources: Record<string, SettingsScope> = {}
  for (const scope of SCOPE_ORDER) {
    const entry = entries.find((e) => e.scope === scope)
    if (!entry?.state.value) continue
    mergeInto(value, entry.state.value, scope, sources, '')
  }
  return { value, sources }
}

function mergeInto(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  scope: SettingsScope,
  sources: Record<string, SettingsScope>,
  prefix: string,
): void {
  for (const [key, v] of Object.entries(src)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(v)) {
      if (!isPlainObject(target[key])) target[key] = {}
      mergeInto(target[key] as Record<string, unknown>, v, scope, sources, path)
    } else {
      target[key] = v
      sources[path] = scope
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/precedence.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/precedence.ts packages/core/tests/precedence.test.ts
git commit -m "feat(core): effective settings resolver with per-key source attribution"
```

---

### Task 8: Surgical edits with diff preview (`edits.ts`)

**Files:**
- Create: `packages/core/src/edits.ts`
- Test: `packages/core/tests/edits.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/edits.test.ts`:
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBackups } from '../src/backups.js'
import { readJsonFile, WriteConflictError } from '../src/json-file.js'
import { applyChange, planJsonUpdate } from '../src/edits.js'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ccs-edit-'))
  return { dir, backupsRoot: join(dir, 'backups') }
}

describe('planJsonUpdate', () => {
  it('sets nested values, creating intermediate objects, and preserves unknown keys', async () => {
    const { dir } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"customUnknownKey": true, "env": {"A": "1"}}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [
      { path: 'env.B', value: '2' },
      { path: 'permissions.defaultMode', value: 'acceptEdits' },
    ])
    expect(change.nextValue).toEqual({
      customUnknownKey: true,
      env: { A: '1', B: '2' },
      permissions: { defaultMode: 'acceptEdits' },
    })
    expect(change.diff).toContain('+    "B": "2"')
  })

  it('removes keys', async () => {
    const { dir } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus", "env": {"A": "1"}}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'env.A', remove: true }])
    expect(change.nextValue).toEqual({ model: 'opus', env: {} })
  })

  it('plans creation of a file that does not exist yet', async () => {
    const { dir } = await setup()
    const state = await readJsonFile<Record<string, unknown>>(join(dir, 'new.json'))
    const change = planJsonUpdate(state, [{ path: 'model', value: 'opus' }])
    expect(change.expectedHash).toBeNull()
    expect(change.nextValue).toEqual({ model: 'opus' })
  })

  it('refuses to edit a file with a parse error', async () => {
    const { dir } = await setup()
    const file = join(dir, 'bad.json')
    await writeFile(file, '{oops')
    const state = await readJsonFile<Record<string, unknown>>(file)
    expect(() => planJsonUpdate(state, [{ path: 'a', value: 1 }])).toThrow(/not valid JSON/)
  })
})

describe('applyChange', () => {
  it('backs up the file, then writes atomically', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus"}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'model', value: 'sonnet' }])
    await applyChange(change, backupsRoot)

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'sonnet' })
    const backups = await listBackups(backupsRoot)
    expect(backups).toHaveLength(1)
    expect(await readFile(backups[0].backupPath, 'utf8')).toBe('{"model": "opus"}')
  })

  it('rejects with WriteConflictError when the file changed after planning', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus"}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'model', value: 'sonnet' }])
    await writeFile(file, '{"model": "haiku"}') // external change
    await expect(applyChange(change, backupsRoot)).rejects.toBeInstanceOf(WriteConflictError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/edits.test.ts`
Expected: FAIL — cannot find module `../src/edits.js`.

- [ ] **Step 3: Implement `edits.ts`**

`packages/core/src/edits.ts`:
```ts
import { createTwoFilesPatch } from 'diff'
import { backupFile } from './backups.js'
import {
  readJsonFile,
  serializeJson,
  WriteConflictError,
  writeJsonFileAtomic,
  type JsonFileState,
} from './json-file.js'

export interface SettingsEdit {
  /** Dotted path into the JSON document, e.g. "permissions.defaultMode" */
  path: string
  /** New value; ignored when remove is true */
  value?: unknown
  remove?: boolean
}

export interface PendingChange {
  filePath: string
  before: string
  after: string
  /** Unified diff for the user-facing preview */
  diff: string
  /** Hash the file must still have at apply time (null = file must not exist). */
  expectedHash: string | null
  nextValue: Record<string, unknown>
}

export function planJsonUpdate(
  state: JsonFileState<Record<string, unknown>>,
  edits: SettingsEdit[],
): PendingChange {
  if (state.parseError) {
    throw new Error(
      `Refusing to edit ${state.path}: existing content is not valid JSON (${state.parseError})`,
    )
  }
  const next = structuredClone(state.value ?? {})
  for (const edit of edits) applyEdit(next, edit)
  const before = state.raw ?? ''
  const after = serializeJson(next)
  return {
    filePath: state.path,
    before,
    after,
    diff: createTwoFilesPatch(state.path, state.path, before, after),
    expectedHash: state.exists ? state.hash! : null,
    nextValue: next,
  }
}

function applyEdit(root: Record<string, unknown>, edit: SettingsEdit): void {
  const keys = edit.path.split('.')
  const last = keys.pop()!
  let node = root
  for (const key of keys) {
    const child = node[key]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      if (edit.remove) return // nothing to remove along a missing path
      node[key] = {}
    }
    node = node[key] as Record<string, unknown>
  }
  if (edit.remove) delete node[last]
  else node[last] = edit.value
}

export async function applyChange(
  change: PendingChange,
  backupsRoot: string,
): Promise<JsonFileState> {
  const current = await readJsonFile(change.filePath)
  const currentHash = current.exists ? current.hash! : null
  if (currentHash !== change.expectedHash) {
    throw new WriteConflictError(change.filePath)
  }
  await backupFile(change.filePath, backupsRoot)
  return writeJsonFileAtomic(change.filePath, change.nextValue, {
    expectedHash: change.expectedHash,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/edits.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/edits.ts packages/core/tests/edits.test.ts
git commit -m "feat(core): surgical JSON edits with diff preview, backup, and conflict-safe apply"
```

---

### Task 9: CLI runner (`cli.ts`)

**Files:**
- Create: `packages/core/src/cli.ts`
- Test: `packages/core/tests/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/cli.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { detectCli, runCommand } from '../src/cli.js'

describe('runCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runCommand('node', ['-e', "console.log('hi')"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hi')
    expect(result.command).toBe(`node -e console.log('hi')`)
  })

  it('captures stderr and a non-zero exit code without throwing', async () => {
    const result = await runCommand('node', ['-e', "console.error('boom'); process.exit(3)"])
    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('boom')
  })

  it('throws for a missing binary', async () => {
    await expect(runCommand('definitely-not-a-real-binary-xyz', [])).rejects.toThrow()
  })
})

describe('detectCli', () => {
  it('reports found=false for a missing binary', async () => {
    expect(await detectCli('definitely-not-a-real-binary-xyz')).toEqual({ found: false })
  })

  it('reports found=true with a version for an existing binary', async () => {
    const info = await detectCli('node')
    expect(info.found).toBe(true)
    expect(info.version).toMatch(/^v\d+/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/cli.test.ts`
Expected: FAIL — cannot find module `../src/cli.js`.

- [ ] **Step 3: Implement `cli.ts`**

`packages/core/src/cli.ts`:
```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CliRunResult {
  /** The exact command run, for verbatim error reporting in the UI */
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Runs a binary via execFile (never a shell — arguments cannot be injected).
 * Non-zero exit codes resolve normally; missing binaries and timeouts throw.
 */
export async function runCommand(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const command = [bin, ...args].join(' ')
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
    })
    return { command, exitCode: 0, stdout, stderr }
  } catch (err) {
    const e = err as Error & { code?: number | string; stdout?: string; stderr?: string }
    if (typeof e.code === 'number') {
      return { command, exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
    throw err
  }
}

export interface CliInfo {
  found: boolean
  version?: string
}

/** Detects the Claude Code CLI (or any binary) by running `<bin> --version`. */
export async function detectCli(bin = 'claude'): Promise<CliInfo> {
  try {
    const result = await runCommand(bin, ['--version'])
    if (result.exitCode !== 0) return { found: false }
    return { found: true, version: result.stdout.trim() }
  } catch {
    return { found: false }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/cli.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/tests/cli.test.ts
git commit -m "feat(core): shell-free CLI runner with claude binary detection"
```

---

### Task 10: Public API + integration test (`index.ts`)

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

`packages/core/tests/integration.test.ts`:
```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyChange,
  getGlobalPaths,
  getProjectPaths,
  listBackups,
  planJsonUpdate,
  readSettingsFiles,
  resolveEffectiveSettings,
} from '../src/index.js'

describe('engine integration', () => {
  it('reads, resolves, edits, and backs up settings in a fixture home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccs-home-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'ccs-proj-'))
    const backupsRoot = join(home, 'backups')
    const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
    const project = getProjectPaths(projectDir)
    await mkdir(global.configDir, { recursive: true })
    await mkdir(join(projectDir, '.claude'), { recursive: true })
    await writeFile(global.settings, JSON.stringify({ model: 'opus', env: { FOO: '1' } }))
    await writeFile(project.settingsLocal, JSON.stringify({ model: 'sonnet' }))

    // 1. Read all scopes and resolve the effective view
    const entries = await readSettingsFiles(global, project)
    const effective = resolveEffectiveSettings(entries)
    expect(effective.value.model).toBe('sonnet')
    expect(effective.sources['model']).toBe('projectLocal')
    expect(effective.sources['env.FOO']).toBe('user')

    // 2. Plan an edit against the user scope, preview the diff, apply it
    const userEntry = entries.find((e) => e.scope === 'user')!
    const change = planJsonUpdate(userEntry.state, [{ path: 'env.BAR', value: '2' }])
    expect(change.diff).toContain('"BAR"')
    await applyChange(change, backupsRoot)

    // 3. The file was updated surgically and the original was backed up
    const updated = JSON.parse(await readFile(global.settings, 'utf8'))
    expect(updated).toEqual({ model: 'opus', env: { FOO: '1', BAR: '2' } })
    const backups = await listBackups(backupsRoot)
    expect(backups).toHaveLength(1)
    expect(backups[0].originalPath).toBe(global.settings)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/integration.test.ts`
Expected: FAIL — the imported names are not exported from `../src/index.js`.

- [ ] **Step 3: Export the public API**

Replace `packages/core/src/index.ts` with:
```ts
export * from './paths.js'
export * from './json-file.js'
export * from './backups.js'
export * from './settings.js'
export * from './precedence.js'
export * from './edits.js'
export * from './cli.js'
```

- [ ] **Step 4: Run the full suite and the type checker**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: all tests PASS (≈27 tests across 6 files); tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/tests/integration.test.ts
git commit -m "feat(core): public API surface with end-to-end integration test"
```

---

### Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add project README"
```
