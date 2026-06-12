# MCP + Plugins Management Implementation Plan (Plan ④)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage MCP servers (list/add/remove across user, local, and project scopes) and plugins/marketplaces (list, install, uninstall, enable, disable, add/remove marketplace) from the GUI.

**Architecture:** Two new core modules. `mcp.ts` reads server definitions directly from the files (shapes verified on a real machine: `~/.claude.json` → top-level `mcpServers` for user scope and `projects[<absDir>].mcpServers` for local scope; `<project>/.mcp.json` → `mcpServers` for project scope) and writes via `claude mcp add-json/remove` with a surgical-file-edit fallback when the CLI is missing. `plugins.ts` is CLI-only — `claude plugin list --json` and `claude plugin marketplace list --json` emit clean JSON (verified), and plugin state files are too version-dependent to hand-edit, so without the CLI the plugins view degrades to a notice. All CLI calls go through an injectable `CliRunner` so tests never touch the real CLI or real config. The server exposes `/api/mcp` and `/api/plugins` routes inside the token-protected plugin, with strict allowlists and argument validation (no leading `-`, no prototype-polluting names — execFile args become CLI flags if they start with a dash). The web app gains two nav views reusing the existing design primitives.

**Tech Stack:** No new dependencies anywhere.

**Verified CLI surface (recon, Claude Code 2.1.175):**
- `claude mcp add-json <name> <json> -s local|user|project` (cwd determines the project for local/project)
- `claude mcp remove <name> -s <scope>`
- `claude plugin list --json` → array of `{id, version, scope, enabled, installPath, installedAt, lastUpdated, projectPath?}`
- `claude plugin marketplace list --json` → array of `{name, source, repo?, installLocation}`
- `claude plugin install|uninstall|enable|disable <plugin>` ; `claude plugin marketplace add <source>` / `remove <name>`

**Design notes the engineer must know:**
- The injectable runner type is `CliRunner` (added to core's `cli.ts` in Task 1). A missing binary surfaces as a thrown error with `code === 'ENOENT'` (that's what promisified `execFile` produces); ONLY that error triggers the MCP file fallback / plugins `cliFound: false`. A non-zero exit code resolves normally (`CliRunResult`) and is reported to the user verbatim — it must NOT trigger the fallback.
- MCP file fallback never uses dotted-path edits (`planJsonUpdate` splits on `.` and server names may contain dots). It navigates real object keys, then reuses `backupFile` + `writeJsonFileAtomic` with the read hash for conflict safety.
- MCP names and plugin identifiers are validated with strict regexes that forbid a leading `-` (would be parsed as a CLI flag by execFile'd commands) and the prototype-polluting keys (`__proto__`, `constructor`, `prototype` — the fallback assigns `obj[name]`).
- `claude plugin install` and `marketplace add` can be slow (git clones) — pass `timeoutMs: 120_000`.
- Baseline test count is 84. Expected after each task: T1→89, T2→95, T3→100, T4→105, T5→110, T6→112, T7→113.

---

### Task 1: Core — MCP read side + `CliRunner` type

**Files:**
- Modify: `packages/core/src/cli.ts` (add the `CliRunner` type export)
- Create: `packages/core/src/mcp.ts` (read side only in this task)
- Modify: `packages/core/src/index.ts` (export `./mcp.js`)
- Test: `packages/core/tests/mcp.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/mcp.test.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths } from '../src/paths.js'
import { readMcpServers } from '../src/mcp.js'

export async function mcpFixture() {
  const home = await mkdtemp(join(tmpdir(), 'ccs-mcp-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'ccs-mcp-proj-'))
  const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(global.configDir, { recursive: true })
  return { home, projectDir, global }
}

describe('readMcpServers', () => {
  it('reads user-scope servers from ~/.claude.json mcpServers', async () => {
    const { global } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://x/mcp' } } }),
    )
    const result = await readMcpServers(global)
    expect(result.servers).toEqual([
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x/mcp' } },
    ])
    expect(result.warnings).toEqual([])
  })

  it('reads local and project scopes when projectDir is given', async () => {
    const { global, projectDir } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      JSON.stringify({
        mcpServers: {},
        projects: {
          [projectDir]: {
            mcpServers: { playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'] } },
          },
        },
      }),
    )
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { type: 'sse', url: 'https://y/sse' } } }),
    )
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([
      {
        name: 'playwright',
        scope: 'local',
        config: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'] },
      },
      { name: 'shared', scope: 'project', config: { type: 'sse', url: 'https://y/sse' } },
    ])
  })

  it('returns empty results when no files exist', async () => {
    const { global, projectDir } = await mcpFixture()
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('surfaces parse errors as warnings instead of throwing', async () => {
    const { global, projectDir } = await mcpFixture()
    await writeFile(global.claudeJson, '{oops')
    await writeFile(join(projectDir, '.mcp.json'), '{also bad')
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain(global.claudeJson)
  })

  it('skips prototype-polluting names defensively', async () => {
    const { global } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      `{"mcpServers": ${'{"__proto__": {"type": "stdio"}, "ok": {"type": "stdio", "command": "x"}}'}}`,
    )
    const result = await readMcpServers(global)
    expect(result.servers.map((s) => s.name)).toEqual(['ok'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/mcp.test.ts`
Expected: FAIL — cannot find module `../src/mcp.js`.

- [ ] **Step 3: Implement**

In `packages/core/src/cli.ts`, add after the `CliRunResult` interface:
```ts
/** Injectable command runner so callers (and tests) can substitute runCommand. */
export type CliRunner = (
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; maxBuffer?: number },
) => Promise<CliRunResult>
```

`packages/core/src/mcp.ts`:
```ts
import { join } from 'node:path'
import { readJsonFile } from './json-file.js'
import type { GlobalPaths } from './paths.js'

export type McpScope = 'user' | 'local' | 'project'

export const MCP_SCOPES: readonly McpScope[] = ['user', 'local', 'project']

/** Loose by design: the CLI owns this format; we pass it through untouched. */
export type McpServerConfig = Record<string, unknown>

export interface McpServerEntry {
  name: string
  scope: McpScope
  config: McpServerConfig
}

export interface McpReadResult {
  servers: McpServerEntry[]
  /** Human-readable problems (e.g. parse errors) — shown, never thrown. */
  warnings: string[]
}

const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function collect(
  raw: unknown,
  scope: McpScope,
  servers: McpServerEntry[],
): void {
  if (!isPlainObject(raw)) return
  for (const [name, config] of Object.entries(raw)) {
    if (FORBIDDEN_NAMES.has(name) || !isPlainObject(config)) continue
    servers.push({ name, scope, config })
  }
}

export function projectMcpJsonPath(projectDir: string): string {
  return join(projectDir, '.mcp.json')
}

export async function readMcpServers(
  global: GlobalPaths,
  projectDir?: string,
): Promise<McpReadResult> {
  const servers: McpServerEntry[] = []
  const warnings: string[] = []

  const claudeJson = await readJsonFile<Record<string, unknown>>(global.claudeJson)
  if (claudeJson.parseError) {
    warnings.push(`${global.claudeJson}: ${claudeJson.parseError}`)
  } else if (claudeJson.value) {
    collect(claudeJson.value.mcpServers, 'user', servers)
    if (projectDir) {
      const projects = claudeJson.value.projects
      if (isPlainObject(projects) && isPlainObject(projects[projectDir])) {
        collect((projects[projectDir] as Record<string, unknown>).mcpServers, 'local', servers)
      }
    }
  }

  if (projectDir) {
    const mcpJson = await readJsonFile<Record<string, unknown>>(projectMcpJsonPath(projectDir))
    if (mcpJson.parseError) {
      warnings.push(`${mcpJson.path}: ${mcpJson.parseError}`)
    } else if (mcpJson.value) {
      collect(mcpJson.value.mcpServers, 'project', servers)
    }
  }

  return { servers, warnings }
}
```

In `packages/core/src/index.ts`, add:
```ts
export * from './mcp.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: 89 tests pass (84 + 5); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/mcp.test.ts
git commit -m "feat(core): read MCP servers across user, local, and project scopes"
```

---

### Task 2: Core — MCP writes (CLI-first, file fallback)

**Files:**
- Modify: `packages/core/src/mcp.ts` (append write side)
- Test: `packages/core/tests/mcp-write.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/mcp-write.test.ts`:
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listBackups } from '../src/backups.js'
import type { CliRunner } from '../src/cli.js'
import { addMcpServer, removeMcpServer } from '../src/mcp.js'
import { mcpFixture } from './mcp.test.js'

const okRunner: CliRunner = vi
  .fn()
  .mockResolvedValue({ command: 'claude …', exitCode: 0, stdout: 'ok', stderr: '' })

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
}

describe('addMcpServer', () => {
  it('shells out to claude mcp add-json when the CLI is available', async () => {
    const { global, projectDir } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: '', stderr: '' }) as CliRunner
    const result = await addMcpServer(
      { name: 'figma', scope: 'project', config: { type: 'http', url: 'https://x' } },
      { global, projectDir, backupsRoot: join(projectDir, 'bak'), runner },
    )
    expect(result.via).toBe('cli')
    expect(vi.mocked(runner).mock.calls[0][0]).toBe('claude')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual([
      'mcp',
      'add-json',
      'figma',
      JSON.stringify({ type: 'http', url: 'https://x' }),
      '-s',
      'project',
    ])
    expect(vi.mocked(runner).mock.calls[0][2]).toMatchObject({ cwd: projectDir })
  })

  it('reports a non-zero CLI exit without falling back', async () => {
    const { global, projectDir } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 1, stdout: '', stderr: 'already exists' }) as CliRunner
    const result = await addMcpServer(
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
      { global, backupsRoot: '/tmp/unused-bak', runner },
    )
    expect(result.via).toBe('cli')
    expect(result.result.exitCode).toBe(1)
    expect(result.result.stderr).toContain('already exists')
  })

  it('falls back to a surgical file edit when the CLI is missing (user scope)', async () => {
    const { global, home } = await mcpFixture()
    await writeFile(global.claudeJson, JSON.stringify({ keepMe: true, mcpServers: {} }))
    const backupsRoot = join(home, 'bak')
    const result = await addMcpServer(
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
      { global, backupsRoot, runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(global.claudeJson, 'utf8'))
    expect(after.keepMe).toBe(true)
    expect(after.mcpServers.figma).toEqual({ type: 'http', url: 'https://x' })
    expect(await listBackups(backupsRoot)).toHaveLength(1)
  })

  it('file fallback writes local scope under projects[projectDir]', async () => {
    const { global, projectDir, home } = await mcpFixture()
    const result = await addMcpServer(
      { name: 'pw', scope: 'local', config: { type: 'stdio', command: 'npx' } },
      { global, projectDir, backupsRoot: join(home, 'bak'), runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(global.claudeJson, 'utf8'))
    expect(after.projects[projectDir].mcpServers.pw).toEqual({ type: 'stdio', command: 'npx' })
  })

  it('rejects invalid names and missing projectDir', async () => {
    const { global } = await mcpFixture()
    const opts = { global, backupsRoot: '/tmp/unused-bak', runner: okRunner }
    await expect(
      addMcpServer({ name: '-evil', scope: 'user', config: {} }, opts),
    ).rejects.toThrow(/name/)
    await expect(
      addMcpServer({ name: '__proto__', scope: 'user', config: {} }, opts),
    ).rejects.toThrow(/name/)
    await expect(
      addMcpServer({ name: 'ok', scope: 'project', config: {} }, opts),
    ).rejects.toThrow(/projectDir/)
  })
})

describe('removeMcpServer', () => {
  it('file fallback deletes from .mcp.json (project scope)', async () => {
    const { global, projectDir, home } = await mcpFixture()
    const mcpJson = join(projectDir, '.mcp.json')
    await writeFile(
      mcpJson,
      JSON.stringify({ mcpServers: { a: { type: 'http', url: 'u' }, b: { type: 'http', url: 'v' } } }),
    )
    const result = await removeMcpServer(
      { name: 'a', scope: 'project' },
      { global, projectDir, backupsRoot: join(home, 'bak'), runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(mcpJson, 'utf8'))
    expect(after.mcpServers).toEqual({ b: { type: 'http', url: 'v' } })
  })

  it('uses claude mcp remove when the CLI is available', async () => {
    const { global } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: '', stderr: '' }) as CliRunner
    const result = await removeMcpServer(
      { name: 'figma', scope: 'user' },
      { global, backupsRoot: '/tmp/unused-bak', runner },
    )
    expect(result.via).toBe('cli')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['mcp', 'remove', 'figma', '-s', 'user'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/mcp-write.test.ts`
Expected: FAIL — `addMcpServer` not exported.

- [ ] **Step 3: Implement** (append to `packages/core/src/mcp.ts`)

```ts
import { backupFile } from './backups.js'
import type { CliRunner, CliRunResult } from './cli.js'
import { writeJsonFileAtomic } from './json-file.js'

/** No leading dash (execFile args starting with - are parsed as flags). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface McpWriteOptions {
  global: GlobalPaths
  projectDir?: string
  backupsRoot: string
  runner: CliRunner
}

export interface McpWriteResult {
  via: 'cli' | 'file'
  result?: CliRunResult
}

function validateTarget(name: string, scope: McpScope, projectDir?: string): void {
  if (!NAME_RE.test(name) || FORBIDDEN_NAMES.has(name)) {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(name)}`)
  }
  if (scope !== 'user' && !projectDir) {
    throw new Error(`projectDir is required for the ${scope} scope`)
  }
}

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export async function addMcpServer(
  target: { name: string; scope: McpScope; config: McpServerConfig },
  opts: McpWriteOptions,
): Promise<McpWriteResult> {
  validateTarget(target.name, target.scope, opts.projectDir)
  try {
    const result = await opts.runner(
      'claude',
      ['mcp', 'add-json', target.name, JSON.stringify(target.config), '-s', target.scope],
      { cwd: opts.projectDir },
    )
    return { via: 'cli', result }
  } catch (err) {
    if (!isMissingBinary(err)) throw err
  }
  await mutateMcpFile(target.scope, opts, target.name, target.config)
  return { via: 'file' }
}

export async function removeMcpServer(
  target: { name: string; scope: McpScope },
  opts: McpWriteOptions,
): Promise<McpWriteResult> {
  validateTarget(target.name, target.scope, opts.projectDir)
  try {
    const result = await opts.runner('claude', ['mcp', 'remove', target.name, '-s', target.scope], {
      cwd: opts.projectDir,
    })
    return { via: 'cli', result }
  } catch (err) {
    if (!isMissingBinary(err)) throw err
  }
  await mutateMcpFile(target.scope, opts, target.name, null)
  return { via: 'file' }
}

/** Fallback path: navigate real keys (never dotted paths — names may contain dots). */
async function mutateMcpFile(
  scope: McpScope,
  opts: McpWriteOptions,
  name: string,
  config: McpServerConfig | null,
): Promise<void> {
  const filePath = scope === 'project' ? projectMcpJsonPath(opts.projectDir!) : opts.global.claudeJson
  const state = await readJsonFile<Record<string, unknown>>(filePath)
  if (state.parseError) {
    throw new Error(`Refusing to edit ${filePath}: not valid JSON (${state.parseError})`)
  }
  const root = structuredClone(state.value ?? {})
  let holder: Record<string, unknown> = root
  if (scope === 'local') {
    if (!isPlainObject(holder.projects)) holder.projects = {}
    const projects = holder.projects as Record<string, unknown>
    if (!isPlainObject(projects[opts.projectDir!])) projects[opts.projectDir!] = {}
    holder = projects[opts.projectDir!] as Record<string, unknown>
  }
  if (!isPlainObject(holder.mcpServers)) holder.mcpServers = {}
  const servers = holder.mcpServers as Record<string, unknown>
  if (config === null) delete servers[name]
  else servers[name] = config
  await backupFile(filePath, opts.backupsRoot)
  await writeJsonFileAtomic(filePath, root, {
    expectedHash: state.exists ? state.hash! : null,
  })
}
```

(Imports merge at the top of the file with the existing ones.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: 95 tests pass (89 + 6... the file has 7 `it` blocks; expect 96 if all counted — report actuals); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp.ts packages/core/tests/mcp-write.test.ts
git commit -m "feat(core): MCP add/remove via claude CLI with conflict-safe file fallback"
```

---

### Task 3: Core — plugins via CLI `--json`

**Files:**
- Create: `packages/core/src/plugins.ts`
- Modify: `packages/core/src/index.ts` (export `./plugins.js`)
- Test: `packages/core/tests/plugins.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/plugins.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '../src/cli.js'
import {
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
} from '../src/plugins.js'

function jsonRunner(payload: unknown): CliRunner {
  return vi.fn().mockResolvedValue({
    command: 'c',
    exitCode: 0,
    stdout: JSON.stringify(payload),
    stderr: '',
  })
}

const PLUGIN = {
  id: 'superpowers@claude-plugins-official',
  version: '5.1.0',
  scope: 'user',
  enabled: true,
  installPath: '/x',
  installedAt: 't',
  lastUpdated: 't',
}

describe('listPlugins / listMarketplaces', () => {
  it('parses claude plugin list --json', async () => {
    const runner = jsonRunner([PLUGIN])
    expect(await listPlugins(runner)).toEqual([PLUGIN])
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'list', '--json'])
  })

  it('parses claude plugin marketplace list --json', async () => {
    const market = { name: 'official', source: 'github', repo: 'a/b', installLocation: '/m' }
    const runner = jsonRunner([market])
    expect(await listMarketplaces(runner)).toEqual([market])
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'marketplace', 'list', '--json'])
  })

  it('throws a readable error when the CLI returns non-zero', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 1, stdout: '', stderr: 'broken' })
    await expect(listPlugins(runner)).rejects.toThrow(/broken/)
  })

  it('throws a readable error on non-JSON output', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: 'warning: not json', stderr: '' })
    await expect(listPlugins(runner)).rejects.toThrow(/JSON/)
  })
})

describe('pluginAction / marketplaceAction', () => {
  it('passes allowlisted actions through with a long timeout for installs', async () => {
    const runner = jsonRunner({})
    await pluginAction(runner, 'install', 'foo@bar')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'install', 'foo@bar'])
    expect(vi.mocked(runner).mock.calls[0][2]).toMatchObject({ timeoutMs: 120_000 })
  })

  it('rejects unknown actions and flag-like identifiers', async () => {
    const runner = jsonRunner({})
    await expect(
      pluginAction(runner, 'destroy' as never, 'foo@bar'),
    ).rejects.toThrow(/action/)
    await expect(pluginAction(runner, 'enable', '--config evil')).rejects.toThrow(/identifier/)
    await expect(marketplaceAction(runner, 'add', '-rf')).rejects.toThrow(/identifier/)
  })

  it('runs marketplace add/remove', async () => {
    const runner = jsonRunner({})
    await marketplaceAction(runner, 'add', 'org/repo')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'marketplace', 'add', 'org/repo'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/plugins.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`packages/core/src/plugins.ts`:
```ts
import type { CliRunner, CliRunResult } from './cli.js'

export interface PluginInfo {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  installedAt: string
  lastUpdated: string
  projectPath?: string
}

export interface MarketplaceInfo {
  name: string
  source: string
  repo?: string
  installLocation: string
}

export type PluginActionName = 'install' | 'uninstall' | 'enable' | 'disable'
export type MarketplaceActionName = 'add' | 'remove'

const PLUGIN_ACTIONS: ReadonlySet<string> = new Set(['install', 'uninstall', 'enable', 'disable'])
const MARKETPLACE_ACTIONS: ReadonlySet<string> = new Set(['add', 'remove'])
const SLOW_ACTIONS: ReadonlySet<string> = new Set(['install', 'add', 'update'])

/** Plugin ids, marketplace names/sources: no leading dash (would parse as a flag). */
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9@:/._~-]*$/

function assertIdentifier(value: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid identifier: ${JSON.stringify(value)}`)
  }
}

async function runJson<T>(runner: CliRunner, args: string[]): Promise<T> {
  const result = await runner('claude', args)
  if (result.exitCode !== 0) {
    throw new Error(`\`claude ${args.join(' ')}\` failed: ${result.stderr || result.stdout}`)
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`\`claude ${args.join(' ')}\` did not return JSON`)
  }
}

export function listPlugins(runner: CliRunner): Promise<PluginInfo[]> {
  return runJson(runner, ['plugin', 'list', '--json'])
}

export function listMarketplaces(runner: CliRunner): Promise<MarketplaceInfo[]> {
  return runJson(runner, ['plugin', 'marketplace', 'list', '--json'])
}

export async function pluginAction(
  runner: CliRunner,
  action: PluginActionName,
  plugin: string,
): Promise<CliRunResult> {
  if (!PLUGIN_ACTIONS.has(action)) throw new Error(`Unknown plugin action: ${String(action)}`)
  assertIdentifier(plugin)
  return runner('claude', ['plugin', action, plugin], {
    timeoutMs: SLOW_ACTIONS.has(action) ? 120_000 : 30_000,
  })
}

export async function marketplaceAction(
  runner: CliRunner,
  action: MarketplaceActionName,
  value: string,
): Promise<CliRunResult> {
  if (!MARKETPLACE_ACTIONS.has(action)) {
    throw new Error(`Unknown marketplace action: ${String(action)}`)
  }
  assertIdentifier(value)
  return runner('claude', ['plugin', 'marketplace', action, value], {
    timeoutMs: SLOW_ACTIONS.has(action) ? 120_000 : 30_000,
  })
}
```

In `packages/core/src/index.ts`, add:
```ts
export * from './plugins.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: ~102 tests pass; tsc clean. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/plugins.test.ts
git commit -m "feat(core): plugin and marketplace management via claude CLI JSON output"
```

---

### Task 4: Server — `/api/mcp` routes (+ runner injection)

**Files:**
- Modify: `packages/server/src/server.ts` (BuildOptions.runner, ctx.runner, route wiring)
- Create: `packages/server/src/routes/mcp.ts`
- Test: `packages/server/tests/mcp-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/mcp-routes.test.ts`:
```ts
import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
}

describe('/api/mcp', () => {
  it('lists servers with cli availability', async () => {
    const { app, globalPaths } = await fixture({ runner: missingRunner })
    await writeFile(
      globalPaths.claudeJson,
      JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://x' } } }),
    )
    const res = await app.inject({ url: '/api/mcp', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.servers).toEqual([
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
    ])
  })

  it('adds a server (file fallback path) and removes it again', async () => {
    const { app, globalPaths } = await fixture({ runner: missingRunner })
    const add = await app.inject({
      method: 'POST',
      url: '/api/mcp/add',
      headers: auth,
      payload: { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
    })
    expect(add.statusCode).toBe(200)
    expect(add.json().via).toBe('file')
    expect(JSON.parse(await readFile(globalPaths.claudeJson, 'utf8')).mcpServers.figma).toBeTruthy()

    const remove = await app.inject({
      method: 'POST',
      url: '/api/mcp/remove',
      headers: auth,
      payload: { name: 'figma', scope: 'user' },
    })
    expect(remove.statusCode).toBe(200)
    expect(JSON.parse(await readFile(globalPaths.claudeJson, 'utf8')).mcpServers).toEqual({})
  })

  it('surfaces non-zero CLI exits as 400 with the command output', async () => {
    const cliRunner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'claude mcp …', exitCode: 1, stdout: '', stderr: 'nope' })
    const { app } = await fixture({ runner: cliRunner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp/add',
      headers: auth,
      payload: { name: 'x', scope: 'user', config: { type: 'stdio', command: 'y' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('nope')
  })

  it('rejects bad names, scopes, configs, and relative projectDir', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const cases = [
      { name: '-evil', scope: 'user', config: {} },
      { name: 'ok', scope: 'global', config: {} },
      { name: 'ok', scope: 'user', config: 'not-an-object' },
      { name: 'ok', scope: 'project', config: {}, projectDir: 'relative/path' },
    ]
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/mcp/add', headers: auth, payload })
      expect(res.statusCode).toBe(400)
    }
  })

  it('requires auth', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/mcp' })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Update the shared fixture** — in `packages/server/tests/helpers.ts`, change `fixture` to accept overrides:

```ts
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGlobalPaths } from '@claude-code-studio/core'
import { buildServer, type BuildOptions } from '../src/server.js'

export const TOKEN = 't-test-token'
export const auth = { authorization: `Bearer ${TOKEN}` }

export async function fixture(overrides: Partial<BuildOptions> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'ccs-srv-'))
  const globalPaths = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(globalPaths.configDir, { recursive: true })
  const backupsRoot = join(home, 'backups')
  const app = buildServer({ token: TOKEN, globalPaths, backupsRoot, ...overrides })
  return { home, globalPaths, backupsRoot, app }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/mcp-routes.test.ts`
Expected: FAIL — `runner` not a BuildOptions field / 404 on routes.

- [ ] **Step 4: Implement**

In `packages/server/src/server.ts`: extend the options and context —

```ts
import { runCommand, type CliRunner } from '@claude-code-studio/core'
```
(merge into the existing core import), then:
```ts
export interface BuildOptions {
  token: string
  globalPaths?: GlobalPaths
  backupsRoot?: string
  webRoot?: string
  /** Injectable for tests; defaults to the real runCommand. */
  runner?: CliRunner
}

export interface ServerContext {
  globalPaths: GlobalPaths
  backupsRoot: string
  runner: CliRunner
}
```
and in `buildServer`:
```ts
  const ctx: ServerContext = {
    globalPaths: opts.globalPaths ?? getGlobalPaths(),
    backupsRoot: opts.backupsRoot ?? getBackupsRoot(),
    runner: opts.runner ?? runCommand,
  }
```
Inside the API plugin block add `mcpRoutes(api, ctx)` (import from `./routes/mcp.js`).

`packages/server/src/routes/mcp.ts`:
```ts
import {
  addMcpServer,
  MCP_SCOPES,
  readMcpServers,
  removeMcpServer,
  type McpScope,
  type McpServerConfig,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

interface McpBody {
  name: string
  scope: McpScope
  config?: McpServerConfig
  projectDir?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validate(body: unknown, needsConfig: boolean): { error?: string; target?: McpBody } {
  if (!isPlainObject(body)) return { error: 'invalid body' }
  const b = body as unknown as McpBody
  if (typeof b.name !== 'string') return { error: 'name is required' }
  if (!MCP_SCOPES.includes(b.scope)) return { error: `scope must be one of ${MCP_SCOPES.join(', ')}` }
  if (b.scope !== 'user') {
    if (!b.projectDir) return { error: 'projectDir is required for this scope' }
    if (!isAbsolute(b.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  if (needsConfig && !isPlainObject(b.config)) return { error: 'config must be an object' }
  return { target: b }
}

export function mcpRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/mcp', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    return readMcpServers(ctx.globalPaths, projectDir)
  })

  app.post('/api/mcp/add', async (req, reply) => {
    const { error, target } = validate(req.body, true)
    if (error) return reply.code(400).send({ error })
    try {
      const result = await addMcpServer(
        { name: target!.name, scope: target!.scope, config: target!.config! },
        {
          global: ctx.globalPaths,
          projectDir: target!.projectDir,
          backupsRoot: ctx.backupsRoot,
          runner: ctx.runner,
        },
      )
      if (result.result && result.result.exitCode !== 0) {
        return reply.code(400).send({
          error: result.result.stderr || result.result.stdout || 'claude mcp failed',
          command: result.result.command,
        })
      }
      return result
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.post('/api/mcp/remove', async (req, reply) => {
    const { error, target } = validate(req.body, false)
    if (error) return reply.code(400).send({ error })
    try {
      const result = await removeMcpServer(
        { name: target!.name, scope: target!.scope },
        {
          global: ctx.globalPaths,
          projectDir: target!.projectDir,
          backupsRoot: ctx.backupsRoot,
          runner: ctx.runner,
        },
      )
      if (result.result && result.result.exitCode !== 0) {
        return reply.code(400).send({
          error: result.result.stderr || result.result.stdout || 'claude mcp failed',
          command: result.result.command,
        })
      }
      return result
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/server/tsconfig.json --noEmit`
(Build core first: `npm run build -w @claude-code-studio/core`.)
Expected: ~107 tests; tsc clean. Report actuals.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): MCP list, add, and remove routes with injectable CLI runner"
```

---

### Task 5: Server — `/api/plugins` routes

**Files:**
- Create: `packages/server/src/routes/plugins.ts`
- Modify: `packages/server/src/server.ts` (wire `pluginsRoutes(api, ctx)`)
- Test: `packages/server/tests/plugins-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/plugins-routes.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
}

const PLUGIN = {
  id: 'superpowers@claude-plugins-official',
  version: '5.1.0',
  scope: 'user',
  enabled: true,
  installPath: '/x',
  installedAt: 't',
  lastUpdated: 't',
}

function listRunner(): CliRunner {
  return vi.fn().mockImplementation((_bin: string, args: string[]) => {
    const payload = args.includes('marketplace')
      ? [{ name: 'official', source: 'github', repo: 'a/b', installLocation: '/m' }]
      : [PLUGIN]
    return Promise.resolve({ command: 'c', exitCode: 0, stdout: JSON.stringify(payload), stderr: '' })
  })
}

describe('/api/plugins', () => {
  it('lists plugins and marketplaces when the CLI is present', async () => {
    const { app } = await fixture({ runner: listRunner() })
    const res = await app.inject({ url: '/api/plugins', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cliFound).toBe(true)
    expect(body.plugins).toEqual([PLUGIN])
    expect(body.marketplaces[0].name).toBe('official')
  })

  it('degrades gracefully when the CLI is missing', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/plugins', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cliFound).toBe(false)
    expect(body.plugins).toEqual([])
    expect(body.marketplaces).toEqual([])
  })

  it('runs allowlisted plugin actions', async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: 'done', stderr: '' }) as CliRunner
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/action',
      headers: auth,
      payload: { action: 'disable', plugin: 'superpowers@claude-plugins-official' },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual([
      'plugin',
      'disable',
      'superpowers@claude-plugins-official',
    ])
  })

  it('rejects unknown actions and flag-like values with 400', async () => {
    const { app } = await fixture({ runner: listRunner() })
    for (const payload of [
      { action: 'nuke', plugin: 'x@y' },
      { action: 'enable', plugin: '--evil' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/plugins/action',
        headers: auth,
        payload,
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('surfaces non-zero exits with the command output', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'claude plugin install x', exitCode: 1, stdout: '', stderr: 'no such plugin' })
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/marketplace',
      headers: auth,
      payload: { action: 'add', value: 'org/repo' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('no such plugin')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/plugins-routes.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement**

`packages/server/src/routes/plugins.ts`:
```ts
import {
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
  type CliRunResult,
  type MarketplaceActionName,
  type PluginActionName,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server.js'

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function sendCliResult(result: CliRunResult, reply: { code(n: number): { send(b: unknown): unknown } }) {
  if (result.exitCode !== 0) {
    return reply.code(400).send({
      error: result.stderr || result.stdout || 'claude CLI failed',
      command: result.command,
    })
  }
  return { ok: true, output: result.stdout }
}

export function pluginsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/plugins', async () => {
    try {
      const [plugins, marketplaces] = await Promise.all([
        listPlugins(ctx.runner),
        listMarketplaces(ctx.runner),
      ])
      return { cliFound: true, plugins, marketplaces }
    } catch (err) {
      if (isMissingBinary(err)) {
        return { cliFound: false, plugins: [], marketplaces: [] }
      }
      throw err
    }
  })

  app.post<{ Body: { action?: PluginActionName; plugin?: string } }>(
    '/api/plugins/action',
    async (req, reply) => {
      const { action, plugin } = req.body ?? {}
      if (typeof action !== 'string' || typeof plugin !== 'string') {
        return reply.code(400).send({ error: 'action and plugin are required' })
      }
      try {
        return sendCliResult(await pluginAction(ctx.runner, action, plugin), reply)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )

  app.post<{ Body: { action?: MarketplaceActionName; value?: string } }>(
    '/api/plugins/marketplace',
    async (req, reply) => {
      const { action, value } = req.body ?? {}
      if (typeof action !== 'string' || typeof value !== 'string') {
        return reply.code(400).send({ error: 'action and value are required' })
      }
      try {
        return sendCliResult(await marketplaceAction(ctx.runner, action, value), reply)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )
}
```

Wire `pluginsRoutes(api, ctx)` in the API plugin block in `server.ts` (import from `./routes/plugins.js`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: ~112 tests; tsc clean. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): plugin and marketplace routes with CLI passthrough and allowlists"
```

---

### Task 6: Web — API client extensions + MCP view

**Files:**
- Modify: `packages/web/src/api.ts` (DTOs + methods)
- Modify: `packages/web/src/App.tsx` (nav entries for both new views; Plugins stub from Task 7's file is created here as a stub)
- Create: `packages/web/src/views/Mcp.tsx`, `packages/web/src/views/Plugins.tsx` (stub)
- Test: `packages/web/tests/mcp-view.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/mcp-view.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Mcp } from '../src/views/Mcp.js'

const LIST = {
  servers: [
    { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x/mcp' } },
    { name: 'playwright', scope: 'local', config: { type: 'stdio', command: 'npx', args: ['@p/mcp'] } },
  ],
  warnings: [],
}

describe('Mcp view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists servers with scope badges and previews the add form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} projectDir="/work/app" />)
    expect(await screen.findByText('figma')).toBeDefined()
    expect(screen.getByText('playwright')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
    expect(screen.getByText('local')).toBeDefined()
    expect(screen.getByText('https://x/mcp')).toBeDefined()

    fireEvent.click(screen.getByText('+ Add server'))
    expect(screen.getByPlaceholderText('server-name')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/mcp-view.test.tsx`
Expected: FAIL — module `../src/views/Mcp.js` missing.

- [ ] **Step 3: Extend `packages/web/src/api.ts`** — append the DTOs and methods:

```ts
export type McpScope = 'user' | 'local' | 'project'

export interface McpServerEntryDto {
  name: string
  scope: McpScope
  config: Record<string, unknown>
}

export interface McpListDto {
  servers: McpServerEntryDto[]
  warnings: string[]
}

export interface PluginDto {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  projectPath?: string
}

export interface MarketplaceDto {
  name: string
  source: string
  repo?: string
  installLocation: string
}

export interface PluginsListDto {
  cliFound: boolean
  plugins: PluginDto[]
  marketplaces: MarketplaceDto[]
}
```

and inside the `Api` class:
```ts
  mcp(projectDir?: string): Promise<McpListDto> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/mcp${q}`)
  }

  mcpAdd(body: {
    name: string
    scope: McpScope
    config: Record<string, unknown>
    projectDir?: string
  }): Promise<{ via: 'cli' | 'file' }> {
    return this.request('/api/mcp/add', { method: 'POST', body: JSON.stringify(body) })
  }

  mcpRemove(body: { name: string; scope: McpScope; projectDir?: string }): Promise<{ via: string }> {
    return this.request('/api/mcp/remove', { method: 'POST', body: JSON.stringify(body) })
  }

  plugins(): Promise<PluginsListDto> {
    return this.request('/api/plugins')
  }

  pluginAction(action: string, plugin: string): Promise<{ ok: boolean; output: string }> {
    return this.request('/api/plugins/action', {
      method: 'POST',
      body: JSON.stringify({ action, plugin }),
    })
  }

  marketplaceAction(action: string, value: string): Promise<{ ok: boolean; output: string }> {
    return this.request('/api/plugins/marketplace', {
      method: 'POST',
      body: JSON.stringify({ action, value }),
    })
  }
```

- [ ] **Step 4: Implement the MCP view**

`packages/web/src/views/Mcp.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Api, McpListDto, McpScope } from '../api.js'
import { parseEditValue } from '../utils.js'

const TRANSPORTS = ['stdio', 'http', 'sse'] as const
type Transport = (typeof TRANSPORTS)[number]

function describeTarget(config: Record<string, unknown>): string {
  if (typeof config.url === 'string') return config.url
  const args = Array.isArray(config.args) ? (config.args as string[]).join(' ') : ''
  return [config.command, args].filter(Boolean).join(' ')
}

export function Mcp({ api, projectDir }: { api: Api; projectDir: string }) {
  const [data, setData] = useState<McpListDto | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    name: '',
    scope: 'user' as McpScope,
    transport: 'stdio' as Transport,
    command: '',
    args: '',
    url: '',
    extra: '',
  })
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api.mcp(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setData({ servers: [], warnings: [] })
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
  }, [reload])

  function buildConfig(): Record<string, unknown> {
    const extra = form.extra.trim() ? parseEditValue(form.extra) : {}
    const base: Record<string, unknown> =
      typeof extra === 'object' && extra !== null && !Array.isArray(extra)
        ? { ...(extra as Record<string, unknown>) }
        : {}
    base.type = form.transport
    if (form.transport === 'stdio') {
      base.command = form.command
      const args = form.args.trim()
      if (args) base.args = args.split(/\s+/)
    } else {
      base.url = form.url
    }
    return base
  }

  async function add() {
    setMessage(null)
    try {
      const result = await api.mcpAdd({
        name: form.name.trim(),
        scope: form.scope,
        config: buildConfig(),
        projectDir: form.scope === 'user' ? undefined : projectDir,
      })
      setMessage({
        kind: 'ok',
        text:
          result.via === 'cli'
            ? `Added via the claude CLI.`
            : `Added by editing the file directly (claude CLI not found) — a backup was kept.`,
      })
      setAdding(false)
      setForm({ ...form, name: '', command: '', args: '', url: '', extra: '' })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function remove(name: string, scope: McpScope) {
    if (!window.confirm(`Remove MCP server "${name}" (${scope} scope)?`)) return
    setMessage(null)
    try {
      await api.mcpRemove({
        name,
        scope,
        projectDir: scope === 'user' ? undefined : projectDir,
      })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  if (!data) return <p className="dim">Loading…</p>

  const needsProjectDir = form.scope !== 'user' && !projectDir

  return (
    <>
      <h2>MCP servers</h2>
      {data.warnings.map((w) => (
        <div className="alert error" key={w}>
          {w}
        </div>
      ))}
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {data.servers.length === 0 ? (
        <p className="dim">No MCP servers configured{projectDir ? '' : ' (set a project directory to see local/project scopes)'}.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Type</th>
              <th>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.servers.map((s) => (
              <tr key={`${s.scope}:${s.name}`}>
                <td className="path">{s.name}</td>
                <td>
                  <span className={`badge ${s.scope === 'user' ? 'user' : s.scope === 'local' ? 'projectLocal' : 'project'}`}>
                    {s.scope}
                  </span>
                </td>
                <td className="dim">{String(s.config.type ?? 'stdio')}</td>
                <td className="value">{describeTarget(s.config)}</td>
                <td>
                  <button className="ghost" onClick={() => void remove(s.name, s.scope)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <button className="ghost" onClick={() => setAdding(!adding)}>
          + Add server
        </button>
      </div>

      {adding && (
        <div className="card">
          <div className="edit-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <input
              placeholder="server-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as McpScope })}
            >
              <option value="user">user (all projects)</option>
              <option value="local">local (this project, private)</option>
              <option value="project">project (shared via .mcp.json)</option>
            </select>
            <select
              value={form.transport}
              onChange={(e) => setForm({ ...form, transport: e.target.value as Transport })}
            >
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {form.transport === 'stdio' ? (
            <div className="edit-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
              <input
                placeholder="command (e.g. npx)"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
              />
              <input
                placeholder="args (space separated)"
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
              />
            </div>
          ) : (
            <div className="edit-row" style={{ gridTemplateColumns: '1fr' }}>
              <input
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          )}
          <div className="edit-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              placeholder='extra config JSON, e.g. {"env": {"KEY": "value"}} (optional)'
              value={form.extra}
              onChange={(e) => setForm({ ...form, extra: e.target.value })}
            />
          </div>
          {needsProjectDir && (
            <div className="alert">Set a project directory in the sidebar for this scope.</div>
          )}
          <div className="toolbar">
            <button
              className="action"
              disabled={
                !form.name.trim() ||
                needsProjectDir ||
                (form.transport === 'stdio' ? !form.command.trim() : !form.url.trim())
              }
              onClick={() => void add()}
            >
              Add server
            </button>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Create the Plugins stub and wire the nav**

`packages/web/src/views/Plugins.tsx` (stub; Task 7 replaces):
```tsx
import type { Api } from '../api.js'

export function Plugins(_props: { api: Api }) {
  return <p className="dim">Plugins arrive in the next task.</p>
}
```

In `packages/web/src/App.tsx`:
- Extend `VIEWS`:
```tsx
const VIEWS = [
  ['dashboard', 'Dashboard'],
  ['effective', 'Effective settings'],
  ['editor', 'Editor'],
  ['mcp', 'MCP servers'],
  ['plugins', 'Plugins'],
  ['backups', 'Backups'],
] as const
```
- Add imports `import { Mcp } from './views/Mcp.js'` and `import { Plugins } from './views/Plugins.js'`, and render branches:
```tsx
        {view === 'mcp' && <Mcp api={api} projectDir={projectDir} />}
        {view === 'plugins' && <Plugins api={api} />}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: ~113 tests; tsc clean; build green. Report actuals.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src packages/web/tests/mcp-view.test.tsx
git commit -m "feat(web): MCP servers view with scoped add form and remove"
```

---

### Task 7: Web — Plugins view

**Files:**
- Modify: `packages/web/src/views/Plugins.tsx` (replace)
- Test: `packages/web/tests/plugins-view.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/plugins-view.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Plugins } from '../src/views/Plugins.js'

const LIST = {
  cliFound: true,
  plugins: [
    {
      id: 'superpowers@claude-plugins-official',
      version: '5.1.0',
      scope: 'user',
      enabled: true,
      installPath: '/x',
    },
  ],
  marketplaces: [{ name: 'claude-plugins-official', source: 'github', repo: 'a/b', installLocation: '/m' }],
}

describe('Plugins view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders plugins and marketplaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} />)
    expect(await screen.findByText('superpowers@claude-plugins-official')).toBeDefined()
    expect(screen.getByText('claude-plugins-official')).toBeDefined()
    expect(screen.getByText('Disable')).toBeDefined()
  })

  it('shows the degraded notice when the CLI is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ cliFound: false, plugins: [], marketplaces: [] }), {
          status: 200,
        }),
      ),
    )
    render(<Plugins api={new Api('t')} />)
    expect(await screen.findByText(/claude CLI/)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/plugins-view.test.tsx`
Expected: FAIL — stub renders placeholder.

- [ ] **Step 3: Implement** — replace `packages/web/src/views/Plugins.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Api, PluginsListDto } from '../api.js'

export function Plugins({ api }: { api: Api }) {
  const [data, setData] = useState<PluginsListDto | null>(null)
  const [installId, setInstallId] = useState('')
  const [marketplaceSrc, setMarketplaceSrc] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await api.plugins())
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setData({ cliFound: false, plugins: [], marketplaces: [] })
    }
  }, [api])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ kind: 'ok', text: okText })
      await reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="dim">Loading…</p>

  if (!data.cliFound) {
    return (
      <>
        <h2>Plugins</h2>
        <div className="alert error">
          Plugin management needs the claude CLI on your PATH — Studio drives{' '}
          <code>claude plugin …</code> rather than editing plugin state by hand. Install Claude
          Code, then reload this page.
        </div>
      </>
    )
  }

  return (
    <>
      <h2>Plugins</h2>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      {data.plugins.length === 0 ? (
        <p className="dim">No plugins installed.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Version</th>
              <th>Scope</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.plugins.map((p, i) => (
              <tr key={`${p.id}:${p.scope}:${p.projectPath ?? i}`}>
                <td className="path">{p.id}</td>
                <td className="dim">{p.version}</td>
                <td>
                  <span className={`badge ${p.scope === 'user' ? 'user' : 'projectLocal'}`}>
                    {p.scope}
                  </span>
                </td>
                <td className="dim">{p.enabled ? 'enabled' : 'disabled'}</td>
                <td>
                  <span className="toolbar" style={{ margin: 0 }}>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.pluginAction(p.enabled ? 'disable' : 'enable', p.id),
                          `${p.enabled ? 'Disabled' : 'Enabled'} ${p.id}`,
                        )
                      }
                    >
                      {p.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Uninstall ${p.id}?`)) {
                          void run(() => api.pluginAction('uninstall', p.id), `Uninstalled ${p.id}`)
                        }
                      }}
                    >
                      Uninstall
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <input
          placeholder="plugin or plugin@marketplace"
          value={installId}
          onChange={(e) => setInstallId(e.target.value)}
        />
        <button
          className="action"
          disabled={busy || !installId.trim()}
          onClick={() =>
            void run(() => api.pluginAction('install', installId.trim()), `Installed ${installId}`)
          }
        >
          Install
        </button>
      </div>

      <h2>Marketplaces</h2>
      {data.marketplaces.length === 0 ? (
        <p className="dim">No marketplaces configured.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.marketplaces.map((m) => (
              <tr key={m.name}>
                <td className="path">{m.name}</td>
                <td className="value">{m.repo ?? m.source}</td>
                <td>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove marketplace ${m.name}?`)) {
                        void run(
                          () => api.marketplaceAction('remove', m.name),
                          `Removed ${m.name}`,
                        )
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar">
        <input
          placeholder="github org/repo, URL, or local path"
          value={marketplaceSrc}
          onChange={(e) => setMarketplaceSrc(e.target.value)}
        />
        <button
          className="action"
          disabled={busy || !marketplaceSrc.trim()}
          onClick={() =>
            void run(
              () => api.marketplaceAction('add', marketplaceSrc.trim()),
              `Added marketplace`,
            )
          }
        >
          Add marketplace
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: ~115 tests; tsc clean; build green. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Plugins.tsx packages/web/tests/plugins-view.test.tsx
git commit -m "feat(web): plugins and marketplaces view with CLI-gated degradation"
```

---

### Task 8: Verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full build + live smoke test (read-only — do NOT add/remove anything real)**

```bash
npm run build
node packages/server/dist/bin.js > /tmp/ccs-p4-smoke.log 2>&1 &
sleep 2
URL=$(grep -o 'http://127.0.0.1:[0-9]*' /tmp/ccs-p4-smoke.log | head -1)
TOKEN=$(grep -o 'token=[0-9a-f]*' /tmp/ccs-p4-smoke.log | head -1 | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/mcp" ; echo
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/plugins" | head -c 400 ; echo
kill %1
```

Expected: `/api/mcp` returns the machine's real user-scope servers (possibly `{"servers":[],"warnings":[]}`); `/api/plugins` returns `cliFound: true` with real plugin JSON. **Only GETs — no mutations.**

- [ ] **Step 2: Update README** — replace the status blockquote with:

```markdown
> Status: early development. Config engine, localhost API server + launcher,
> web UI core (dashboard, effective settings, editor with diff preview,
> backups), and MCP + plugin management are done. Next up: hooks, agents,
> skills, and CLAUDE.md editors.
```

- [ ] **Step 3: Final suite**

Run: `npx vitest run`
Expected: ~115 tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README status update for MCP and plugin management"
```
