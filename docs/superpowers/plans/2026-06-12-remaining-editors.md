# Remaining Editors Implementation Plan (Plan ⑤)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit the markdown/file side of Claude Code config — CLAUDE.md, agents, skills, keybindings — plus a hooks browser and the Effective→Editor click-through, completing the v1 UI surface.

**Architecture:** Core gains `text-file.ts` (read/atomic-write text with the same hash-conflict semantics as JSON) and `managed-files.ts` — the safety boundary: clients send `{kind, scope, name}` and the SERVER resolves the absolute path against known roots (agents dir, skills dir, CLAUDE.md, keybindings.json); strict name regexes make traversal impossible. The server exposes `/api/files` (list), `/api/files/read`, `/api/files/save` (backup + atomic + 409). The web app gains a Files view (kind tabs, file list, plain editor with conflict-aware save and create-new) and a Hooks view (plain-English event catalog over the existing settings API, with "edit in Editor" jumps). The jump mechanism — App-level `editorJump` state consumed by the Editor — also powers the Effective view's click-through (the spec's "killer feature" carry-over).

**Tech Stack:** No new dependencies.

**Design notes the engineer must know:**
- Hooks are NOT a new file: they live under the `hooks` key of the settings files, already editable via the preview/apply pipeline. The Hooks view is a *browser* (event catalog + current per-scope config) that deep-links into the Editor with the dotted path prefilled. Don't build a second write path.
- File kinds and their resolution (user scope from `GlobalPaths`, project scope from `ProjectPaths`): `claudeMd` → `claudeMd` (no name); `keybindings` → `keybindings` (user scope only, no name); `agent` → `<agentsDir>/<name>` where name matches `/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/`; `skill` → `<skillsDir>/<name>/SKILL.md` where name matches `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. The regexes contain no `/` and no leading dot, so `..`-traversal cannot be expressed. Memory files are deferred (location is session-tooling-dependent) — note in the view copy, not built.
- `writeTextFileAtomic` mirrors `writeJsonFileAtomic` exactly (same `expectedHash` semantics: undefined = skip, null = must-not-exist, string = must match) and reuses `hashContent`/`WriteConflictError` from `json-file.ts`. Saving an agent/skill creates parent directories (`mkdir -p`), so "create new skill" needs no extra code path.
- The Editor jump: App holds `editorJump: {scope, path} | null`; Effective rows (non-managed sources) and Hooks "Edit" buttons set it and switch views; the Editor consumes it in a `useEffect` (set scope, seed one edit row, clear via callback). Managed-source rows are not clickable (read-only scope).
- Baseline test count is 118. Estimates after each task: T1→122, T2→129, T3→135, T4→137, T5→139, T6→141. Report actuals.

---

### Task 1: Core — `text-file.ts`

**Files:**
- Create: `packages/core/src/text-file.ts`
- Modify: `packages/core/src/index.ts` (add export)
- Test: `packages/core/tests/text-file.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/text-file.test.ts`:
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WriteConflictError } from '../src/json-file.js'
import { readTextFile, writeTextFileAtomic } from '../src/text-file.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ccs-text-'))
}

describe('readTextFile', () => {
  it('reports a missing file without throwing', async () => {
    const dir = await tempDir()
    const state = await readTextFile(join(dir, 'nope.md'))
    expect(state.exists).toBe(false)
    expect(state.content).toBeUndefined()
  })

  it('reads content and computes a hash', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, '# Hello\n')
    const state = await readTextFile(file)
    expect(state.exists).toBe(true)
    expect(state.content).toBe('# Hello\n')
    expect(state.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('writeTextFileAtomic', () => {
  it('writes content, creating parent directories', async () => {
    const dir = await tempDir()
    const file = join(dir, 'deep', 'skill', 'SKILL.md')
    await writeTextFileAtomic(file, '---\nname: x\n---\n')
    expect(await readFile(file, 'utf8')).toBe('---\nname: x\n---\n')
  })

  it('enforces expectedHash conflict semantics', async () => {
    const dir = await tempDir()
    const file = join(dir, 'b.md')
    await writeFile(file, 'v1')
    const before = await readTextFile(file)
    await writeFile(file, 'v2') // external change
    await expect(
      writeTextFileAtomic(file, 'v3', { expectedHash: before.hash }),
    ).rejects.toBeInstanceOf(WriteConflictError)
    await expect(writeTextFileAtomic(file, 'v3', { expectedHash: null })).rejects.toBeInstanceOf(
      WriteConflictError,
    )
    const current = await readTextFile(file)
    const after = await writeTextFileAtomic(file, 'v3', { expectedHash: current.hash })
    expect(after.content).toBe('v3')
    expect(await readFile(file, 'utf8')).toBe('v3')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/text-file.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`packages/core/src/text-file.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashContent, WriteConflictError } from './json-file.js'

export interface TextFileState {
  path: string
  exists: boolean
  content?: string
  /** sha256 hex of content; used for write-conflict detection */
  hash?: string
}

export async function readTextFile(path: string): Promise<TextFileState> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, exists: false }
    }
    throw err
  }
  return { path, exists: true, content, hash: hashContent(content) }
}

/** Same expectedHash semantics as writeJsonFileAtomic (undefined skip / null must-not-exist / string must match). */
export async function writeTextFileAtomic(
  path: string,
  content: string,
  opts: { expectedHash?: string | null } = {},
): Promise<TextFileState> {
  if (opts.expectedHash !== undefined) {
    const current = await readTextFile(path)
    const currentHash = current.exists ? current.hash! : null
    if (currentHash !== opts.expectedHash) {
      throw new WriteConflictError(path)
    }
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
  return { path, exists: true, content, hash: hashContent(content) }
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from './text-file.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: 122 tests; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/text-file.test.ts
git commit -m "feat(core): atomic text file IO with hash-based conflict detection"
```

---

### Task 2: Core — `managed-files.ts` (server-side path resolution + listing)

**Files:**
- Create: `packages/core/src/managed-files.ts`
- Modify: `packages/core/src/index.ts` (add export)
- Test: `packages/core/tests/managed-files.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/managed-files.test.ts`:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProjectPaths } from '../src/paths.js'
import { listManagedFiles, resolveManagedFile } from '../src/managed-files.js'
import { mcpFixture } from './fixtures.js'

describe('resolveManagedFile', () => {
  it('resolves every kind for the user scope', async () => {
    const { global } = await mcpFixture()
    expect(resolveManagedFile({ kind: 'claudeMd', scope: 'user' }, global)).toBe(global.claudeMd)
    expect(resolveManagedFile({ kind: 'keybindings', scope: 'user' }, global)).toBe(
      global.keybindings,
    )
    expect(resolveManagedFile({ kind: 'agent', scope: 'user', name: 'helper.md' }, global)).toBe(
      join(global.agentsDir, 'helper.md'),
    )
    expect(resolveManagedFile({ kind: 'skill', scope: 'user', name: 'my-skill' }, global)).toBe(
      join(global.skillsDir, 'my-skill', 'SKILL.md'),
    )
  })

  it('resolves project-scope kinds from ProjectPaths', async () => {
    const { global, projectDir } = await mcpFixture()
    const project = getProjectPaths(projectDir)
    expect(resolveManagedFile({ kind: 'claudeMd', scope: 'project' }, global, project)).toBe(
      project.claudeMd,
    )
    expect(
      resolveManagedFile({ kind: 'agent', scope: 'project', name: 'a.md' }, global, project),
    ).toBe(join(project.agentsDir, 'a.md'))
  })

  it('rejects traversal, bad names, and invalid kind/scope combinations', async () => {
    const { global, projectDir } = await mcpFixture()
    const project = getProjectPaths(projectDir)
    expect(() =>
      resolveManagedFile({ kind: 'agent', scope: 'user', name: '../evil.md' }, global),
    ).toThrow(/name/)
    expect(() =>
      resolveManagedFile({ kind: 'agent', scope: 'user', name: 'no-extension' }, global),
    ).toThrow(/name/)
    expect(() =>
      resolveManagedFile({ kind: 'skill', scope: 'user', name: 'a/b' }, global),
    ).toThrow(/name/)
    expect(() => resolveManagedFile({ kind: 'agent', scope: 'user' }, global)).toThrow(/name/)
    expect(() =>
      resolveManagedFile({ kind: 'keybindings', scope: 'project' }, global, project),
    ).toThrow(/user scope/)
    expect(() => resolveManagedFile({ kind: 'claudeMd', scope: 'project' }, global)).toThrow(
      /project/,
    )
  })
})

describe('listManagedFiles', () => {
  it('lists agents, skills, and singleton files per scope', async () => {
    const { global, projectDir } = await mcpFixture()
    const project = getProjectPaths(projectDir)
    await mkdir(global.agentsDir, { recursive: true })
    await writeFile(join(global.agentsDir, 'reviewer.md'), '# r')
    await writeFile(join(global.agentsDir, 'notes.txt'), 'ignore me')
    await mkdir(join(global.skillsDir, 'deploy'), { recursive: true })
    await writeFile(join(global.skillsDir, 'deploy', 'SKILL.md'), '# s')
    await mkdir(join(global.skillsDir, 'broken-no-skill-md'), { recursive: true })
    await writeFile(global.claudeMd, '# global')

    const listing = await listManagedFiles(global, project)
    expect(listing.user.claudeMd.exists).toBe(true)
    expect(listing.user.keybindings?.exists).toBe(false)
    expect(listing.user.agents).toEqual([
      { name: 'reviewer.md', path: join(global.agentsDir, 'reviewer.md') },
    ])
    expect(listing.user.skills).toEqual([
      { name: 'deploy', path: join(global.skillsDir, 'deploy', 'SKILL.md') },
    ])
    expect(listing.project?.claudeMd.exists).toBe(false)
    expect(listing.project?.keybindings).toBeUndefined()
    expect(listing.project?.agents).toEqual([])
  })

  it('handles entirely missing directories', async () => {
    const { global } = await mcpFixture()
    const listing = await listManagedFiles(global)
    expect(listing.user.agents).toEqual([])
    expect(listing.user.skills).toEqual([])
    expect(listing.project).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/tests/managed-files.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`packages/core/src/managed-files.ts`:
```ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GlobalPaths, ProjectPaths } from './paths.js'

export type FileKind = 'claudeMd' | 'keybindings' | 'agent' | 'skill'
export type FileScope = 'user' | 'project'

export interface ManagedFileRef {
  kind: FileKind
  scope: FileScope
  /** Required for agent (foo.md) and skill (skill-dir-name); forbidden otherwise. */
  name?: string
}

/** No `/`, no leading dot — traversal cannot be expressed. */
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * The safety boundary for file editing: clients send {kind, scope, name};
 * the server resolves the absolute path against known roots only.
 */
export function resolveManagedFile(
  ref: ManagedFileRef,
  global: GlobalPaths,
  project?: ProjectPaths,
): string {
  if (ref.scope === 'project' && !project) {
    throw new Error('project paths are required for the project scope')
  }
  const roots = ref.scope === 'user' ? global : project!
  switch (ref.kind) {
    case 'claudeMd':
      return roots.claudeMd
    case 'keybindings':
      if (ref.scope !== 'user') throw new Error('keybindings exist only in the user scope')
      return global.keybindings
    case 'agent':
      if (!ref.name || !AGENT_NAME_RE.test(ref.name)) {
        throw new Error(`Invalid agent file name: ${JSON.stringify(ref.name)}`)
      }
      return join(roots.agentsDir, ref.name)
    case 'skill':
      if (!ref.name || !SKILL_NAME_RE.test(ref.name)) {
        throw new Error(`Invalid skill name: ${JSON.stringify(ref.name)}`)
      }
      return join(roots.skillsDir, ref.name, 'SKILL.md')
  }
}

export interface NamedFile {
  name: string
  path: string
}

export interface ScopeFiles {
  claudeMd: { path: string; exists: boolean }
  keybindings?: { path: string; exists: boolean }
  agents: NamedFile[]
  skills: NamedFile[]
}

export interface ManagedFilesListing {
  user: ScopeFiles
  project?: ScopeFiles
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function listAgents(agentsDir: string): Promise<NamedFile[]> {
  let names: string[]
  try {
    names = await readdir(agentsDir)
  } catch {
    return []
  }
  return names
    .filter((n) => AGENT_NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, path: join(agentsDir, name) }))
}

async function listSkills(skillsDir: string): Promise<NamedFile[]> {
  let names: string[]
  try {
    names = await readdir(skillsDir)
  } catch {
    return []
  }
  const skills: NamedFile[] = []
  for (const name of names.filter((n) => SKILL_NAME_RE.test(n)).sort()) {
    const path = join(skillsDir, name, 'SKILL.md')
    if (await fileExists(path)) skills.push({ name, path })
  }
  return skills
}

async function scopeFiles(
  roots: Pick<GlobalPaths, 'claudeMd' | 'agentsDir' | 'skillsDir'>,
  keybindings?: string,
): Promise<ScopeFiles> {
  const result: ScopeFiles = {
    claudeMd: { path: roots.claudeMd, exists: await fileExists(roots.claudeMd) },
    agents: await listAgents(roots.agentsDir),
    skills: await listSkills(roots.skillsDir),
  }
  if (keybindings) {
    result.keybindings = { path: keybindings, exists: await fileExists(keybindings) }
  }
  return result
}

export async function listManagedFiles(
  global: GlobalPaths,
  project?: ProjectPaths,
): Promise<ManagedFilesListing> {
  const listing: ManagedFilesListing = {
    user: await scopeFiles(global, global.keybindings),
  }
  if (project) {
    listing.project = await scopeFiles(project)
  }
  return listing
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from './managed-files.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: ~127 tests; tsc clean. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/managed-files.test.ts
git commit -m "feat(core): managed file resolution and listing with traversal-proof names"
```

---

### Task 3: Server — `/api/files` routes

**Files:**
- Create: `packages/server/src/routes/files.ts`
- Modify: `packages/server/src/server.ts` (wire `filesRoutes(api, ctx)` in the API plugin block)
- Test: `packages/server/tests/files-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/server/tests/files-routes.test.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBackups } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

describe('/api/files', () => {
  it('lists files for the user scope (and project when projectDir given)', async () => {
    const { app, globalPaths } = await fixture()
    await mkdir(globalPaths.agentsDir, { recursive: true })
    await writeFile(join(globalPaths.agentsDir, 'helper.md'), '# h')
    const projectDir = await mkdtemp(join(tmpdir(), 'ccs-files-proj-'))

    const res = await app.inject({
      url: `/api/files?projectDir=${encodeURIComponent(projectDir)}`,
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.agents).toEqual([
      { name: 'helper.md', path: join(globalPaths.agentsDir, 'helper.md') },
    ])
    expect(body.project.claudeMd.exists).toBe(false)
  })

  it('reads a file by reference, never by path', async () => {
    const { app, globalPaths } = await fixture()
    await writeFile(globalPaths.claudeMd, '# my rules\n')
    const res = await app.inject({
      url: '/api/files/read?kind=claudeMd&scope=user',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.content).toBe('# my rules\n')
    expect(typeof body.hash).toBe('string')
  })

  it('saves with backup and detects conflicts', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.claudeMd, 'v1')
    const read = await app.inject({
      url: '/api/files/read?kind=claudeMd&scope=user',
      headers: auth,
    })
    const { hash } = read.json()

    const save = await app.inject({
      method: 'POST',
      url: '/api/files/save',
      headers: auth,
      payload: { kind: 'claudeMd', scope: 'user', content: 'v2', expectedHash: hash },
    })
    expect(save.statusCode).toBe(200)
    expect(await readFile(globalPaths.claudeMd, 'utf8')).toBe('v2')
    expect(await listBackups(backupsRoot)).toHaveLength(1)

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/files/save',
      headers: auth,
      payload: { kind: 'claudeMd', scope: 'user', content: 'v3', expectedHash: hash },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().code).toBe('WRITE_CONFLICT')
  })

  it('creates a new skill (expectedHash null) with parent directories', async () => {
    const { app, globalPaths } = await fixture()
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/save',
      headers: auth,
      payload: {
        kind: 'skill',
        scope: 'user',
        name: 'deploy',
        content: '---\nname: deploy\n---\n',
        expectedHash: null,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(await readFile(join(globalPaths.skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toContain(
      'deploy',
    )
  })

  it('rejects traversal names, bad kinds, and relative projectDir with 400', async () => {
    const { app } = await fixture()
    const cases = [
      { url: '/api/files/read?kind=agent&scope=user&name=../../etc/passwd' },
      { url: '/api/files/read?kind=nope&scope=user' },
      { url: '/api/files/read?kind=claudeMd&scope=project&projectDir=relative' },
      { url: '/api/files/read?kind=claudeMd&scope=project' },
    ]
    for (const c of cases) {
      const res = await app.inject({ url: c.url, headers: auth })
      expect(res.statusCode).toBe(400)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/files-routes.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement**

`packages/server/src/routes/files.ts`:
```ts
import {
  backupFile,
  getProjectPaths,
  listManagedFiles,
  readTextFile,
  resolveManagedFile,
  WriteConflictError,
  writeTextFileAtomic,
  type FileKind,
  type FileScope,
  type ManagedFileRef,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

const KINDS: ReadonlySet<string> = new Set(['claudeMd', 'keybindings', 'agent', 'skill'])
const SCOPES: ReadonlySet<string> = new Set(['user', 'project'])

interface RefQuery {
  kind?: string
  scope?: string
  name?: string
  projectDir?: string
}

function parseRef(q: RefQuery): { error?: string; ref?: ManagedFileRef; projectDir?: string } {
  if (!q.kind || !KINDS.has(q.kind)) return { error: 'invalid kind' }
  if (!q.scope || !SCOPES.has(q.scope)) return { error: 'invalid scope' }
  if (q.scope === 'project') {
    if (!q.projectDir) return { error: 'projectDir is required for the project scope' }
    if (!isAbsolute(q.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  return {
    ref: { kind: q.kind as FileKind, scope: q.scope as FileScope, name: q.name },
    projectDir: q.projectDir,
  }
}

export function filesRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/files', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    return listManagedFiles(ctx.globalPaths, projectDir ? getProjectPaths(projectDir) : undefined)
  })

  app.get<{ Querystring: RefQuery }>('/api/files/read', async (req, reply) => {
    const { error, ref, projectDir } = parseRef(req.query)
    if (error) return reply.code(400).send({ error })
    let path: string
    try {
      path = resolveManagedFile(
        ref!,
        ctx.globalPaths,
        projectDir ? getProjectPaths(projectDir) : undefined,
      )
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    const state = await readTextFile(path)
    return { path: state.path, exists: state.exists, content: state.content ?? '', hash: state.hash ?? null }
  })

  app.post<{
    Body: RefQuery & { content?: unknown; expectedHash?: unknown }
  }>('/api/files/save', async (req, reply) => {
    const body = req.body ?? {}
    const { error, ref, projectDir } = parseRef(body)
    if (error) return reply.code(400).send({ error })
    if (typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' })
    }
    if (typeof body.expectedHash !== 'string' && body.expectedHash !== null) {
      return reply.code(400).send({ error: 'expectedHash must be a string or null' })
    }
    let path: string
    try {
      path = resolveManagedFile(
        ref!,
        ctx.globalPaths,
        projectDir ? getProjectPaths(projectDir) : undefined,
      )
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    try {
      await backupFile(path, ctx.backupsRoot)
      const state = await writeTextFileAtomic(path, body.content, {
        expectedHash: body.expectedHash,
      })
      return { saved: true, path: state.path, hash: state.hash }
    } catch (err) {
      if (err instanceof WriteConflictError) {
        return reply.code(409).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
```

Wire `filesRoutes(api, ctx)` inside the API plugin block in `server.ts` (import from `./routes/files.js`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @claude-code-studio/core && npx vitest run && npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: ~132 tests; tsc clean. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): managed file routes with server-resolved paths and conflict-safe saves"
```

---

### Task 4: Web — Files view

**Files:**
- Modify: `packages/web/src/api.ts` (DTOs + methods)
- Create: `packages/web/src/views/Files.tsx`
- Modify: `packages/web/src/App.tsx` (nav entry `['files', 'Agents & files']` after 'editor'; render branch passing api + projectDir)
- Test: `packages/web/tests/files-view.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/files-view.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Files } from '../src/views/Files.js'

const LISTING = {
  user: {
    claudeMd: { path: '/h/.claude/CLAUDE.md', exists: true },
    keybindings: { path: '/h/.claude/keybindings.json', exists: false },
    agents: [{ name: 'reviewer.md', path: '/h/.claude/agents/reviewer.md' }],
    skills: [],
  },
}

const READ = { path: '/h/.claude/agents/reviewer.md', exists: true, content: '# Reviewer', hash: 'abc' }

describe('Files view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('lists agents and opens one in the editor pane', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const payload = url.startsWith('/api/files/read') ? READ : LISTING
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )
    render(<Files api={new Api('t')} projectDir="" />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/files-view.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Extend `packages/web/src/api.ts`** — append:

```ts
export type FileKind = 'claudeMd' | 'keybindings' | 'agent' | 'skill'
export type FileScope = 'user' | 'project'

export interface NamedFileDto {
  name: string
  path: string
}

export interface ScopeFilesDto {
  claudeMd: { path: string; exists: boolean }
  keybindings?: { path: string; exists: boolean }
  agents: NamedFileDto[]
  skills: NamedFileDto[]
}

export interface FilesListingDto {
  user: ScopeFilesDto
  project?: ScopeFilesDto
}

export interface FileContentDto {
  path: string
  exists: boolean
  content: string
  hash: string | null
}
```

and inside the `Api` class:
```ts
  files(projectDir?: string): Promise<FilesListingDto> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/files${q}`)
  }

  fileRead(ref: {
    kind: FileKind
    scope: FileScope
    name?: string
    projectDir?: string
  }): Promise<FileContentDto> {
    const params = new URLSearchParams()
    params.set('kind', ref.kind)
    params.set('scope', ref.scope)
    if (ref.name) params.set('name', ref.name)
    if (ref.projectDir) params.set('projectDir', ref.projectDir)
    return this.request(`/api/files/read?${params.toString()}`)
  }

  fileSave(body: {
    kind: FileKind
    scope: FileScope
    name?: string
    projectDir?: string
    content: string
    expectedHash: string | null
  }): Promise<{ saved: boolean; path: string; hash: string }> {
    return this.request('/api/files/save', { method: 'POST', body: JSON.stringify(body) })
  }
```

- [ ] **Step 4: Implement the view**

`packages/web/src/views/Files.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type FileKind, type FileScope, type FilesListingDto } from '../api.js'

const TABS = [
  ['claudeMd', 'CLAUDE.md'],
  ['agent', 'Agents'],
  ['skill', 'Skills'],
  ['keybindings', 'Keybindings'],
] as const

type Tab = (typeof TABS)[number][0]

interface Open {
  kind: FileKind
  scope: FileScope
  name?: string
  content: string
  hash: string | null
  path: string
}

export function Files({ api, projectDir }: { api: Api; projectDir: string }) {
  const [listing, setListing] = useState<FilesListingDto | null>(null)
  const [tab, setTab] = useState<Tab>('claudeMd')
  const [scope, setScope] = useState<FileScope>('user')
  const [open, setOpen] = useState<Open | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setListing(await api.files(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
      setListing({ user: { claudeMd: { path: '', exists: false }, agents: [], skills: [] } })
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
    setOpen(null)
    setMessage(null)
  }, [reload])

  const effectiveScope: FileScope = tab === 'keybindings' ? 'user' : scope
  const scopeFiles = effectiveScope === 'user' ? listing?.user : listing?.project

  async function openFile(kind: FileKind, name?: string) {
    setMessage(null)
    try {
      const ref = {
        kind,
        scope: effectiveScope,
        name,
        projectDir: effectiveScope === 'project' ? projectDir : undefined,
      }
      const file = await api.fileRead(ref)
      setOpen({ ...ref, content: file.content, hash: file.hash, path: file.path })
      setDirty(false)
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  async function save() {
    if (!open) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.fileSave({
        kind: open.kind,
        scope: open.scope,
        name: open.name,
        projectDir: open.scope === 'project' ? projectDir : undefined,
        content: open.content,
        expectedHash: open.hash,
      })
      setOpen({ ...open, hash: result.hash })
      setDirty(false)
      setMessage({ kind: 'ok', text: 'Saved. The previous version was backed up.' })
      await reload()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({
          kind: 'error',
          text: 'This file changed on disk since you opened it — reopen it to see the current content.',
        })
      } else {
        setMessage({ kind: 'error', text: (e as Error).message })
      }
    } finally {
      setBusy(false)
    }
  }

  function createNew() {
    const kind = tab as FileKind
    const name = kind === 'agent' && !newName.endsWith('.md') ? `${newName}.md` : newName
    setOpen({
      kind,
      scope: effectiveScope,
      name,
      content: kind === 'skill' ? `---\nname: ${newName}\ndescription: \n---\n\n` : '',
      hash: null,
      path: '(new file)',
    })
    setDirty(true)
    setNewName('')
  }

  if (!listing) return <p className="dim">Loading…</p>

  const needsProjectDir = effectiveScope === 'project' && !projectDir

  return (
    <>
      <h2>Agents &amp; files</h2>
      <div className="scope-picker">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active projectLocal' : ''}
            onClick={() => {
              setTab(key)
              setOpen(null)
              setMessage(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== 'keybindings' && (
        <div className="scope-picker">
          {(['user', 'project'] as const).map((s) => (
            <button
              key={s}
              className={scope === s ? `active ${s}` : ''}
              onClick={() => {
                setScope(s)
                setOpen(null)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      {needsProjectDir ? (
        <div className="alert">Set a project directory in the sidebar for project-scope files.</div>
      ) : (
        <>
          {tab === 'claudeMd' && (
            <div className="toolbar">
              <button className="ghost" onClick={() => void openFile('claudeMd')}>
                {scopeFiles?.claudeMd.exists ? 'Open CLAUDE.md' : 'Create CLAUDE.md'}
              </button>
              <span className="dim">{scopeFiles?.claudeMd.path}</span>
            </div>
          )}
          {tab === 'keybindings' && (
            <div className="toolbar">
              <button className="ghost" onClick={() => void openFile('keybindings')}>
                {listing.user.keybindings?.exists ? 'Open keybindings.json' : 'Create keybindings.json'}
              </button>
              <span className="dim">{listing.user.keybindings?.path}</span>
            </div>
          )}
          {(tab === 'agent' || tab === 'skill') && (
            <>
              {(tab === 'agent' ? scopeFiles?.agents : scopeFiles?.skills)?.length === 0 ? (
                <p className="dim">None yet.</p>
              ) : (
                <table className="kv">
                  <tbody>
                    {(tab === 'agent' ? scopeFiles?.agents : scopeFiles?.skills)?.map((f) => (
                      <tr key={f.name}>
                        <td className="path">
                          <button className="ghost" onClick={() => void openFile(tab, f.name)}>
                            {f.name}
                          </button>
                        </td>
                        <td className="value dim">{f.path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="toolbar">
                <input
                  placeholder={tab === 'agent' ? 'new-agent-name' : 'new-skill-name'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button className="ghost" disabled={!newName.trim()} onClick={createNew}>
                  + New {tab}
                </button>
              </div>
            </>
          )}

          {open && (
            <>
              <p className="dim">
                {open.path}
                {dirty ? ' — unsaved changes' : ''}
              </p>
              <textarea
                rows={18}
                style={{ width: '100%', resize: 'vertical' }}
                value={open.content}
                onChange={(e) => {
                  setOpen({ ...open, content: e.target.value })
                  setDirty(true)
                }}
              />
              <div className="toolbar">
                <button className="action" disabled={busy || !dirty} onClick={() => void save()}>
                  Save
                </button>
                <button className="ghost" onClick={() => setOpen(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
```

In `packages/web/src/App.tsx`: add `['files', 'Agents & files'],` to `VIEWS` after the `editor` entry, import `Files`, and render `{view === 'files' && <Files api={api} projectDir={projectDir} />}`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: ~133 tests; tsc clean; build green. Report actuals.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src packages/web/tests/files-view.test.tsx
git commit -m "feat(web): files view for CLAUDE.md, agents, skills, and keybindings"
```

---

### Task 5: Web — Editor jump plumbing + Effective click-through

**Files:**
- Modify: `packages/web/src/App.tsx` (editorJump state)
- Modify: `packages/web/src/views/Editor.tsx` (jump prop)
- Modify: `packages/web/src/views/Effective.tsx` (clickable rows)
- Test: `packages/web/tests/effective.test.tsx` (append)

- [ ] **Step 1: Write the failing test** (append inside the describe block in `effective.test.tsx`; merge `fireEvent` into the testing-library import and `vi` usage as needed)

```tsx
  it('clicking a non-managed row jumps to the editor with scope and path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
    )
    const onEdit = vi.fn()
    render(<Effective api={new Api('t')} projectDir="" onEdit={onEdit} />)
    fireEvent.click(await screen.findByText('model'))
    expect(onEdit).toHaveBeenCalledWith('projectLocal', 'model')
  })
```

Also ensure this test file has RTL `cleanup()` in its afterEach (add it if missing, matching mcp-view.test.tsx).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/effective.test.tsx`
Expected: FAIL — `onEdit` prop doesn't exist / never called.

- [ ] **Step 3: Implement**

In `packages/web/src/views/Effective.tsx`:
- Change the signature to accept the callback:
```tsx
export function Effective({
  api,
  projectDir,
  onEdit,
}: {
  api: Api
  projectDir: string
  onEdit?: (scope: 'user' | 'project' | 'projectLocal', path: string) => void
}) {
```
- Make non-managed rows clickable — replace the row rendering with:
```tsx
            {leaves.map((leaf) => {
              const editable = leaf.source && leaf.source !== 'managed'
              return (
                <tr
                  key={leaf.path}
                  style={editable && onEdit ? { cursor: 'pointer' } : undefined}
                  title={editable ? 'Click to edit this value at its source scope' : undefined}
                  onClick={
                    editable && onEdit
                      ? () => onEdit(leaf.source as 'user' | 'project' | 'projectLocal', leaf.path)
                      : undefined
                  }
                >
                  <td className="path">{leaf.path}</td>
                  <td className="value">{JSON.stringify(leaf.value)}</td>
                  <td>
                    {leaf.source ? <span className={`badge ${leaf.source}`}>{leaf.source}</span> : null}
                  </td>
                </tr>
              )
            })}
```

In `packages/web/src/views/Editor.tsx`:
- Extend the props and add the consume effect:
```tsx
export interface EditorJump {
  scope: EditableScope
  path: string
}

export function Editor({
  api,
  projectDir,
  jump,
  onJumpConsumed,
}: {
  api: Api
  projectDir: string
  jump?: EditorJump | null
  onJumpConsumed?: () => void
}) {
```
and inside the component, after the existing state declarations:
```tsx
  useEffect(() => {
    if (!jump) return
    setScope(jump.scope)
    setRows([{ path: jump.path, value: '', remove: false }])
    setPending(null)
    setMessage(null)
    onJumpConsumed?.()
  }, [jump, onJumpConsumed])
```
(Export the `EditableScope` type if it isn't already: `export type EditableScope = (typeof EDITABLE)[number]`.)

In `packages/web/src/App.tsx`:
```tsx
import { Editor, type EditorJump } from './views/Editor.js'
```
add state and handler:
```tsx
  const [editorJump, setEditorJump] = useState<EditorJump | null>(null)

  function jumpToEditor(scope: EditorJump['scope'], path: string) {
    setEditorJump({ scope, path })
    setView('editor')
  }
```
and wire the views:
```tsx
        {view === 'effective' && <Effective api={api} projectDir={projectDir} onEdit={jumpToEditor} />}
        {view === 'editor' && (
          <Editor
            api={api}
            projectDir={projectDir}
            jump={editorJump}
            onJumpConsumed={() => setEditorJump(null)}
          />
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: ~134 tests; tsc clean; build green. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src packages/web/tests/effective.test.tsx
git commit -m "feat(web): effective-to-editor click-through with scope-aware jump"
```

---

### Task 6: Web — Hooks view

**Files:**
- Create: `packages/web/src/views/Hooks.tsx`
- Modify: `packages/web/src/App.tsx` (nav entry `['hooks', 'Hooks']` after 'files'; render branch with `onEdit={jumpToEditor}`)
- Test: `packages/web/tests/hooks-view.test.tsx`

- [ ] **Step 1: Write the failing component test**

`packages/web/tests/hooks-view.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Hooks } from '../src/views/Hooks.js'

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: {
        path: '/h/.claude/settings.json',
        exists: true,
        value: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: {}, sources: {} },
}

describe('Hooks view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows configured events and jumps to the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
    )
    const onEdit = vi.fn()
    render(<Hooks api={new Api('t')} projectDir="" onEdit={onEdit} />)
    expect(await screen.findByText('PreToolUse')).toBeDefined()
    expect(screen.getByText(/echo hi/)).toBeDefined()
    fireEvent.click(screen.getAllByText('Edit in Editor')[0])
    expect(onEdit).toHaveBeenCalledWith('user', 'hooks.PreToolUse')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/hooks-view.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`packages/web/src/views/Hooks.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Api, SettingsResponse, SettingsScope } from '../api.js'

const HOOK_EVENTS: ReadonlyArray<[string, string]> = [
  ['PreToolUse', 'Runs before a tool call; can block or modify it.'],
  ['PostToolUse', 'Runs after a tool call completes.'],
  ['UserPromptSubmit', 'Runs when you submit a prompt, before Claude sees it.'],
  ['Notification', 'Runs when Claude Code sends a notification.'],
  ['Stop', 'Runs when Claude finishes responding.'],
  ['SubagentStop', 'Runs when a subagent finishes.'],
  ['PreCompact', 'Runs before the conversation context is compacted.'],
  ['SessionStart', 'Runs when a session starts or resumes.'],
  ['SessionEnd', 'Runs when a session ends.'],
]

type EditableScope = 'user' | 'project' | 'projectLocal'

export function Hooks({
  api,
  projectDir,
  onEdit,
}: {
  api: Api
  projectDir: string
  onEdit?: (scope: EditableScope, path: string) => void
}) {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="dim">Loading…</p>

  function hooksFor(scope: SettingsScope, event: string): unknown {
    const entry = data!.entries.find((e) => e.scope === scope)
    const hooks = entry?.state.value?.hooks
    if (typeof hooks !== 'object' || hooks === null) return undefined
    return (hooks as Record<string, unknown>)[event]
  }

  const editableScopes = data.entries
    .filter((e) => e.editable)
    .map((e) => e.scope) as EditableScope[]

  return (
    <>
      <h2>Hooks</h2>
      <p className="dim">
        Hooks run shell commands at lifecycle events — they live under the <code>hooks</code> key
        of your settings files. Treat them like code you ship to yourself: review every command.
      </p>
      {HOOK_EVENTS.map(([event, description]) => {
        const configured = editableScopes
          .map((scope) => ({ scope, config: hooksFor(scope, event) }))
          .filter((c) => c.config !== undefined)
        return (
          <div className="card" key={event} style={{ marginBottom: '1rem' }}>
            <div className="label">{event}</div>
            <p className="dim" style={{ margin: '0.25rem 0 0.75rem' }}>
              {description}
            </p>
            {configured.length === 0 ? (
              <p className="dim" style={{ margin: 0 }}>
                Not configured.
              </p>
            ) : (
              configured.map(({ scope, config }) => (
                <div key={scope} style={{ marginBottom: '0.5rem' }}>
                  <span className={`badge ${scope}`}>{scope}</span>
                  <pre className="code" style={{ marginTop: '0.4rem' }}>
                    {JSON.stringify(config, null, 2)}
                  </pre>
                </div>
              ))
            )}
            {onEdit && (
              <div className="toolbar" style={{ margin: 0 }}>
                {(configured.length > 0
                  ? configured.map((c) => c.scope)
                  : (['user'] as EditableScope[])
                ).map((scope) => (
                  <button
                    key={scope}
                    className="ghost"
                    onClick={() => onEdit(scope, `hooks.${event}`)}
                  >
                    Edit in Editor
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
```

In `packages/web/src/App.tsx`: add `['hooks', 'Hooks'],` to `VIEWS` after the `files` entry, import `Hooks`, render `{view === 'hooks' && <Hooks api={api} projectDir={projectDir} onEdit={jumpToEditor} />}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc -p packages/web/tsconfig.json --noEmit && npm run build -w @claude-code-studio/web`
Expected: ~135 tests; tsc clean; build green. Report actuals.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src packages/web/tests/hooks-view.test.tsx
git commit -m "feat(web): hooks browser with event catalog and editor deep links"
```

---

### Task 7: Verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full build + read-only live smoke test**

```bash
npm run build
node packages/server/dist/bin.js > /tmp/ccs-p5-smoke.log 2>&1 &
sleep 2
URL=$(grep -o 'http://127.0.0.1:[0-9]*' /tmp/ccs-p5-smoke.log | head -1)
TOKEN=$(grep -o 'token=[0-9a-f]*' /tmp/ccs-p5-smoke.log | head -1 | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/files" | head -c 400; echo
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/files/read?kind=claudeMd&scope=user" | head -c 200; echo
pkill -f "packages/server/dist/bin.js"
```

Expected: real user-scope listing (agents/skills from the actual machine); CLAUDE.md content or exists:false. **GETs only — no saves against the real home directory.**

- [ ] **Step 2: Update README** — replace the status blockquote with:

```markdown
> Status: v1 feature-complete. Config engine, localhost API server + launcher,
> and the full web UI: dashboard, effective settings with click-through
> editing, settings editor with diff preview, MCP + plugin management,
> CLAUDE.md/agents/skills/keybindings editors, hooks browser, and backups.
```

- [ ] **Step 3: Final suite**

Run: `npx vitest run`
Expected: ~135 tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README status update for v1 feature completeness"
```
