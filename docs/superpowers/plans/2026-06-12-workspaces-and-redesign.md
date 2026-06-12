# Workspaces & Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single path-textbox project handling with a project picker fed by Claude Code's own project list, split the UI into strictly separated Global and Project workspaces, and re-skin the app as a modern dashboard (sans-serif chrome, mono for data).

**Architecture:** One new read-only server route (`GET /api/projects`) reads the `projects` keys of `~/.claude.json`. The web app is rebuilt around a `Workspace` discriminated union (`{kind:'global'} | {kind:'project', dir}`); each view receives `workspace` instead of `projectDir` and gates its scope tabs accordingly. Tasks 3–7 convert views one at a time (keeping the old shell compiling via a shim), Task 8 replaces the shell, Task 9 re-skins.

**Tech Stack:** Fastify (server), React 18 + Vite (web), Vitest (+ jsdom/RTL for components), `@fontsource/inter` added.

**Spec:** `docs/superpowers/specs/2026-06-12-workspaces-and-redesign-design.md`

**Conventions for every task:**
- Run tests from the repo root: `npx vitest run <path>`; full suite: `npx vitest run`.
- Plain `git commit` — sole author, no Co-Authored-By trailer, never mention AI.
- Component tests need `// @vitest-environment jsdom` and explicit `cleanup()` in `afterEach` (vitest globals are off, RTL does not auto-clean).

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/server/src/routes/projects.ts` | Create | `GET /api/projects` — known + extra project dirs with existence stamps |
| `packages/server/src/server.ts` | Modify | register `projectsRoutes` |
| `packages/server/tests/projects.test.ts` | Create | route tests |
| `packages/web/src/api.ts` | Modify | `ProjectDto`, `Api.listProjects` |
| `packages/web/src/workspace.ts` | Create | `Workspace` type + helpers |
| `packages/web/src/views/Editor.tsx` | Modify | workspace-gated scope tabs, managed read-only tab |
| `packages/web/src/views/Hooks.tsx` | Modify | workspace-gated scopes |
| `packages/web/src/views/Files.tsx` | Modify | workspace-locked file scope, keybindings global-only |
| `packages/web/src/views/Mcp.tsx` | Modify | workspace-filtered servers + form scopes |
| `packages/web/src/views/Overview.tsx` | Create (rename from `Dashboard.tsx`) | global-only env overview |
| `packages/web/src/App.tsx` | Rewrite | two-group sidebar, project picker, workspace routing, banner |
| `packages/web/src/main.tsx` | Modify | Inter font imports |
| `packages/web/src/styles.css` | Rewrite | modern dashboard design system |
| `packages/web/package.json` | Modify | add `@fontsource/inter` |
| `packages/web/tests/*` | Modify/Create | per-view updates + `app-shell.test.tsx`, `overview.test.tsx` |

---

### Task 1: `GET /api/projects` server route

**Files:**
- Create: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/projects.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/projects.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auth, fixture } from './helpers.js'

describe('GET /api/projects', () => {
  it('rejects requests without the bearer token', async () => {
    const { app } = await fixture()
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('returns an empty list when ~/.claude.json does not exist', async () => {
    const { app } = await fixture()
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ projects: [] })
  })

  it('lists known projects with basename and on-disk existence', async () => {
    const { app, home, globalPaths } = await fixture()
    const real = join(home, 'real-project')
    await mkdir(real, { recursive: true })
    await writeFile(
      globalPaths.claudeJson,
      JSON.stringify({ projects: { [real]: {}, '/nope/gone': {} } }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.json()).toEqual({
      projects: [
        { dir: real, name: 'real-project', exists: true },
        { dir: '/nope/gone', name: 'gone', exists: false },
      ],
    })
  })

  it('merges extras, deduplicating against known projects and each other', async () => {
    const { app, home, globalPaths } = await fixture()
    const known = join(home, 'known')
    const extraDir = join(home, 'extra')
    await mkdir(known, { recursive: true })
    await mkdir(extraDir, { recursive: true })
    await writeFile(globalPaths.claudeJson, JSON.stringify({ projects: { [known]: {} } }))
    const extra = encodeURIComponent(`${known},${extraDir},${extraDir}`)
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects?extra=${extra}`,
      headers: auth,
    })
    expect(res.json()).toEqual({
      projects: [
        { dir: known, name: 'known', exists: true },
        { dir: extraDir, name: 'extra', exists: true },
      ],
    })
  })

  it('treats a malformed projects key as empty', async () => {
    const { app, globalPaths } = await fixture()
    await writeFile(globalPaths.claudeJson, JSON.stringify({ projects: 'oops' }))
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.json()).toEqual({ projects: [] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/tests/projects.test.ts`
Expected: FAIL — all non-401 tests 404 (route does not exist). The 401 test may already pass (unmatched routes inside the api plugin still hit the token hook only when matched — expect 404 here, so the assertion `toBe(401)` fails too; that is fine, it goes green once the route exists).

- [ ] **Step 3: Write the route**

Create `packages/server/src/routes/projects.ts`:

```ts
import { readJsonFile } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { ServerContext } from '../server.js'

interface ProjectsQuery {
  extra?: string
}

/**
 * Lists the project directories Claude Code itself knows about (the keys of
 * `projects` in ~/.claude.json) plus any client-supplied extras. Read-only:
 * extras only ever hit existsSync — never a file read or write.
 */
export function projectsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/projects', async (req) => {
    const { extra } = req.query as ProjectsQuery
    const state = await readJsonFile(ctx.globalPaths.claudeJson)
    const projectsValue = state.value?.projects
    const known =
      typeof projectsValue === 'object' && projectsValue !== null && !Array.isArray(projectsValue)
        ? Object.keys(projectsValue)
        : []
    const extras = (extra ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !known.includes(s))
    const projects = [...known, ...new Set(extras)].map((dir) => ({
      dir,
      name: basename(dir),
      exists: existsSync(dir),
    }))
    return { projects }
  })
}
```

Modify `packages/server/src/server.ts` — add the import after the plugins import:

```ts
import { projectsRoutes } from './routes/projects.js'
```

and register it inside the encapsulated api plugin, after `filesRoutes(api, ctx)`:

```ts
    projectsRoutes(api, ctx)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/tests/projects.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/server.ts packages/server/tests/projects.test.ts
git commit -m "feat(server): list known project directories via GET /api/projects"
```

---

### Task 2: `Api.listProjects` client method

**Files:**
- Modify: `packages/web/src/api.ts`
- Test: `packages/web/tests/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('Api', …)` block in `packages/web/tests/api.test.ts`:

```ts
  it('lists projects and encodes extras into one query param', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new Api('tok').listProjects(['/a b', '/c'])
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/projects?extra=${encodeURIComponent('/a b,/c')}`)
  })

  it('omits the extra param when there are no extras', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new Api('tok').listProjects([])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/api.test.ts`
Expected: FAIL — `listProjects is not a function`.

- [ ] **Step 3: Implement**

In `packages/web/src/api.ts`, add the DTO next to the other DTOs (after `HealthDto`):

```ts
export interface ProjectDto {
  dir: string
  name: string
  exists: boolean
}
```

and the method inside `class Api` (after `health()`):

```ts
  listProjects(extra: string[] = []): Promise<{ projects: ProjectDto[] }> {
    const q = extra.length > 0 ? `?extra=${encodeURIComponent(extra.join(','))}` : ''
    return this.request(`/api/projects${q}`)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/tests/api.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api.ts packages/web/tests/api.test.ts
git commit -m "feat(web): api client for the project list"
```

---

### Task 3: `Workspace` type + Editor workspace conversion

The Editor becomes each workspace's "Settings" view: in Global it offers `user` plus a read-only `managed` tab; in a Project it offers `project` and `projectLocal`. The old App keeps compiling via a one-line shim (replaced for good in Task 8).

**Files:**
- Create: `packages/web/src/workspace.ts`
- Modify: `packages/web/src/views/Editor.tsx`
- Modify: `packages/web/src/App.tsx` (shim only)
- Test: `packages/web/tests/editor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `packages/web/tests/editor.test.tsx` entirely with:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    {
      scope: 'managed',
      editable: false,
      state: { path: '/etc/m.json', exists: true, raw: '{"locked": true}' },
    },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

const PROJECT_SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/home/u/.claude/settings.json', exists: true, raw: '{"model": "opus"}' },
    },
    {
      scope: 'project',
      editable: true,
      state: { path: '/work/app/.claude/settings.json', exists: true, raw: '{"model": "sonnet"}' },
    },
    {
      scope: 'projectLocal',
      editable: true,
      state: { path: '/work/app/.claude/settings.local.json', exists: false },
    },
  ],
  effective: { value: { model: 'sonnet' }, sources: { model: 'project' } },
}

const PREVIEW = {
  filePath: '/home/u/.claude/settings.json',
  before: '{"model": "opus"}',
  after: '{\n  "model": "sonnet"\n}\n',
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n-{"model": "opus"}\n+  "model": "sonnet"',
  expectedHash: 'abc',
  nextValue: { model: 'sonnet' },
}

function stubFetch(settings: unknown = SETTINGS) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/settings/preview')) {
      return Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(settings), { status: 200 }))
  })
}

describe('Editor view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows the user file and previews a diff', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    expect(await screen.findByText('{"model": "opus"}')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('model or env.FOO'), {
      target: { value: 'model' },
    })
    fireEvent.change(screen.getByPlaceholderText('"sonnet" or {"a": 1} or plain text'), {
      target: { value: '"sonnet"' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Preview diff'))
    })

    expect(await screen.findByText('+  "model": "sonnet"', { normalizer: (s) => s })).toBeDefined()
    expect(screen.getByText('Apply change')).toBeDefined()
  })

  it('discards a previewed diff when an edit row is deleted', async () => {
    vi.stubGlobal('fetch', stubFetch())
    const { container } = render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    const view = within(container)

    await view.findByText('{"model": "opus"}')

    fireEvent.change(view.getByPlaceholderText('model or env.FOO'), {
      target: { value: 'model' },
    })
    fireEvent.change(view.getByPlaceholderText('"sonnet" or {"a": 1} or plain text'), {
      target: { value: '"sonnet"' },
    })
    fireEvent.click(view.getByText('Preview diff'))
    await view.findByText('Apply change')

    fireEvent.click(view.getByText('×'))
    expect(view.queryByText('Apply change')).toBeNull()
  })

  it('global workspace offers user and managed tabs; managed is read-only', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('{"model": "opus"}')

    expect(screen.queryByRole('button', { name: 'project' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'managed' }))
    expect(await screen.findByText('{"locked": true}')).toBeDefined()
    expect(screen.getByText(/read-only/)).toBeDefined()
    expect(screen.queryByText('Preview diff')).toBeNull()
  })

  it('project workspace offers only project scopes and queries with the project dir', async () => {
    const fetchMock = stubFetch(PROJECT_SETTINGS)
    vi.stubGlobal('fetch', fetchMock)
    render(<Editor api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    expect(await screen.findByText('{"model": "sonnet"}')).toBeDefined()

    expect(screen.queryByRole('button', { name: 'user' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'managed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'projectLocal' })).toBeDefined()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/settings?projectDir=${encodeURIComponent('/work/app')}`)
  })

  it('honors a jump into a scope tab', async () => {
    vi.stubGlobal('fetch', stubFetch(PROJECT_SETTINGS))
    const consumed = vi.fn()
    render(
      <Editor
        api={new Api('t')}
        workspace={{ kind: 'project', dir: '/work/app' }}
        jump={{ scope: 'projectLocal', path: 'hooks.Stop' }}
        onJumpConsumed={consumed}
      />,
    )
    expect(await screen.findByDisplayValue('hooks.Stop')).toBeDefined()
    expect(consumed).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/editor.test.tsx`
Expected: FAIL — TypeScript/props mismatch (`workspace` not accepted; old `projectDir` required).

- [ ] **Step 3: Implement**

Create `packages/web/src/workspace.ts`:

```ts
export type Workspace = { kind: 'global' } | { kind: 'project'; dir: string }

export function workspaceProjectDir(ws: Workspace): string {
  return ws.kind === 'project' ? ws.dir : ''
}

/** Folder basename, tolerant of both path separators (client-side fallback). */
export function projectName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}
```

Replace `packages/web/src/views/Editor.tsx` entirely with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type PendingChangeDto, type SettingsResponse } from '../api.js'
import { diffLineKind, parseEditValue } from '../utils.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

export type EditableScope = 'user' | 'project' | 'projectLocal'
export type EditorScope = EditableScope | 'managed'

export interface EditorJump {
  scope: EditableScope
  path: string
}

interface EditRow {
  path: string
  value: string
  remove: boolean
}

const EMPTY_ROW: EditRow = { path: '', value: '', remove: false }

function scopeTabs(workspace: Workspace): readonly EditorScope[] {
  return workspace.kind === 'global' ? ['user', 'managed'] : ['project', 'projectLocal']
}

export function Editor({
  api,
  workspace,
  jump,
  onJumpConsumed,
}: {
  api: Api
  workspace: Workspace
  jump?: EditorJump | null
  onJumpConsumed?: () => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = scopeTabs(workspace)
  const [scope, setScope] = useState<EditorScope>(tabs[0])
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [rows, setRows] = useState<EditRow[]>([EMPTY_ROW])
  const [pending, setPending] = useState<PendingChangeDto | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!jump) return
    if (scopeTabs(workspace).includes(jump.scope)) {
      setScope(jump.scope)
      setRows([{ path: jump.path, value: '', remove: false }])
      setPending(null)
      setMessage(null)
    }
    onJumpConsumed?.()
  }, [jump, onJumpConsumed, workspace])

  const reload = useCallback(async () => {
    setData(null)
    try {
      setData(await api.settings(projectDir || undefined))
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }, [api, projectDir])

  useEffect(() => {
    void reload()
    setPending(null)
    setMessage(null)
  }, [reload])

  const entry = data?.entries.find((e) => e.scope === scope)
  const readonly = scope === 'managed'

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
        scope: scope as EditableScope,
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
        scope: scope as EditableScope,
        projectDir: scope === 'user' ? undefined : projectDir,
        edits: buildEdits(),
        expectedHash: pending.expectedHash,
      })
      setPending(null)
      setRows([EMPTY_ROW])
      await reload()
      setMessage({ kind: 'ok', text: 'Change applied. A backup of the previous file was kept.' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setPending(null)
        await reload()
        setMessage({
          kind: 'error',
          text: 'The file changed on disk since the preview — re-preview to see the current state.',
        })
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
      <h2>Settings</h2>
      <div className="scope-picker">
        {tabs.map((s) => (
          <button
            key={s}
            className={scope === s ? `active ${s}` : ''}
            onClick={() => {
              setScope(s)
              setPending(null)
              setRows([EMPTY_ROW])
              setMessage(null)
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <p className="dim">{entry ? entry.state.path : ''}</p>
      {readonly ? (
        <>
          <div className="alert">
            Managed settings are machine-level policy and read-only — Studio never writes them.
          </div>
          <pre className="code">{entry?.state.raw ?? '(file does not exist)'}</pre>
        </>
      ) : entry?.state.parseError ? (
        <div className="alert error">
          This file is not valid JSON ({entry.state.parseError}). Fix it in your editor of choice —
          Studio refuses to write through a parse failure.
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
                onClick={() => {
                  setRows((rs) => rs.filter((_, j) => j !== i))
                  setPending(null)
                }}
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

      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
    </>
  )
}
```

Notes on what changed vs v1: the `EDITABLE` array is gone (scope tabs come from the workspace); `needsProjectDir` is gone (a project workspace always has a dir); a `managed` read-only tab exists in Global; the heading is "Settings". The component does NOT reset scope when `workspace` changes — Task 8's App remounts it via a `key` per workspace, which is the supported way to switch.

In `packages/web/src/App.tsx` (still the old shell), shim the Editor call site — replace:

```tsx
          <Editor
            api={api}
            projectDir={projectDir}
            jump={editorJump}
            onJumpConsumed={onJumpConsumed}
          />
```

with:

```tsx
          <Editor
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
            jump={editorJump}
            onJumpConsumed={onJumpConsumed}
          />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/editor.test.tsx && npx vitest run`
Expected: editor tests pass; full suite green (the shim keeps App compiling).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/workspace.ts packages/web/src/views/Editor.tsx packages/web/src/App.tsx packages/web/tests/editor.test.tsx
git commit -m "feat(web): workspace-scoped settings editor with read-only managed tab"
```

---

### Task 4: Hooks workspace conversion

**Files:**
- Modify: `packages/web/src/views/Hooks.tsx`
- Modify: `packages/web/src/App.tsx` (shim)
- Test: `packages/web/tests/hooks-view.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `packages/web/tests/hooks-view.test.tsx` entirely with:

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
    {
      scope: 'project',
      editable: true,
      state: {
        path: '/work/app/.claude/settings.json',
        exists: true,
        value: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } },
      },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: {}, sources: {} },
}

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
  )
}

describe('Hooks view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows user hooks only and jumps to the editor', async () => {
    stub()
    const onEdit = vi.fn()
    render(<Hooks api={new Api('t')} workspace={{ kind: 'global' }} onEdit={onEdit} />)
    expect(await screen.findByText('PreToolUse')).toBeDefined()
    expect(screen.getByText(/echo hi/)).toBeDefined()
    // project-scope hook config must not leak into the global workspace
    expect(screen.queryByText(/say done/)).toBeNull()
    fireEvent.click(screen.getAllByText('Edit in Editor')[0])
    expect(onEdit).toHaveBeenCalledWith('user', 'hooks.PreToolUse')
  })

  it('project workspace shows project hooks only and adds at project scope', async () => {
    stub()
    const onEdit = vi.fn()
    render(
      <Hooks api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} onEdit={onEdit} />,
    )
    expect(await screen.findByText(/say done/)).toBeDefined()
    expect(screen.queryByText(/echo hi/)).toBeNull()
    // an unconfigured event offers to add at the project scope
    fireEvent.click(screen.getAllByText('Edit in Editor')[1])
    expect(onEdit).toHaveBeenCalledWith('project', expect.stringMatching(/^hooks\./))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/hooks-view.test.tsx`
Expected: FAIL — props mismatch.

- [ ] **Step 3: Implement**

Replace `packages/web/src/views/Hooks.tsx` entirely with:

```tsx
import { useEffect, useState } from 'react'
import type { Api, SettingsEntryDto, SettingsResponse, SettingsScope } from '../api.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'
import type { EditableScope } from './Editor.js'

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

function hookConfig(entry: SettingsEntryDto, event: string): unknown {
  const hooks = entry.state.value?.hooks
  if (typeof hooks !== 'object' || hooks === null) return undefined
  return (hooks as Record<string, unknown>)[event]
}

export function Hooks({
  api,
  workspace,
  onEdit,
}: {
  api: Api
  workspace: Workspace
  onEdit?: (scope: EditableScope, path: string) => void
}) {
  const projectDir = workspaceProjectDir(workspace)
  const scopes: readonly SettingsScope[] =
    workspace.kind === 'global' ? ['user', 'managed'] : ['project', 'projectLocal']
  const fallbackScope: EditableScope = workspace.kind === 'global' ? 'user' : 'project'
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

  const visible = data.entries.filter((e) => scopes.includes(e.scope))

  return (
    <>
      <h2>Hooks</h2>
      <p className="dim">
        Hooks run shell commands at lifecycle events — they live under the <code>hooks</code> key
        of your settings files. Treat them like code you ship to yourself: review every command.
      </p>
      {HOOK_EVENTS.map(([event, description]) => {
        const configured = visible
          .map((entry) => ({ scope: entry.scope, editable: entry.editable, config: hookConfig(entry, event) }))
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
                {configured.length > 0
                  ? configured
                      .filter((c) => c.editable)
                      .map((c) => (
                        <button
                          key={c.scope}
                          className="ghost"
                          onClick={() => onEdit(c.scope as EditableScope, `hooks.${event}`)}
                        >
                          Edit in Editor
                        </button>
                      ))
                  : (
                    <button
                      className="ghost"
                      title={`Adds the hook at the ${fallbackScope} scope`}
                      onClick={() => onEdit(fallbackScope, `hooks.${event}`)}
                    >
                      Edit in Editor
                    </button>
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
```

(`SettingsEntryDto` is already exported from `api.ts`.)

In `packages/web/src/App.tsx`, shim the Hooks call site — replace:

```tsx
        {view === 'hooks' && <Hooks api={api} projectDir={projectDir} onEdit={jumpToEditor} />}
```

with:

```tsx
        {view === 'hooks' && (
          <Hooks
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
            onEdit={jumpToEditor}
          />
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/hooks-view.test.tsx && npx vitest run`
Expected: green across the suite.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Hooks.tsx packages/web/src/App.tsx packages/web/tests/hooks-view.test.tsx
git commit -m "feat(web): scope the hooks browser to its workspace"
```

---

### Task 5: Files workspace conversion

Global shows CLAUDE.md / Agents / Skills / Keybindings at the locked `user` scope; Project shows CLAUDE.md / Agents / Skills at the locked `project` scope. The scope picker row disappears.

**Files:**
- Modify: `packages/web/src/views/Files.tsx`
- Modify: `packages/web/src/App.tsx` (shim)
- Test: `packages/web/tests/files-view.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `packages/web/tests/files-view.test.tsx` entirely with:

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
  project: {
    claudeMd: { path: '/work/app/CLAUDE.md', exists: false },
    agents: [{ name: 'deployer.md', path: '/work/app/.claude/agents/deployer.md' }],
    skills: [],
  },
}

const READ = { path: '/h/.claude/agents/reviewer.md', exists: true, content: '# Reviewer', hash: 'abc' }

function stub() {
  return vi.fn().mockImplementation((url: string) => {
    const payload = url.startsWith('/api/files/read') ? READ : LISTING
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

describe('Files view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace lists user agents and opens one', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
    // keybindings is a global-only tab
    expect(screen.getByText('Keybindings')).toBeDefined()
  })

  it('project workspace lists project agents and hides keybindings', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    expect(await screen.findByText('deployer.md')).toBeDefined()
    expect(screen.queryByText('reviewer.md')).toBeNull()
    expect(screen.queryByText('Keybindings')).toBeNull()
  })

  it('asks before discarding unsaved changes on tab switch', async () => {
    vi.stubGlobal('fetch', stub())
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    const textarea = await screen.findByDisplayValue('# Reviewer')
    fireEvent.change(textarea, { target: { value: '# Edited' } })

    fireEvent.click(screen.getByText('Skills'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByDisplayValue('# Edited')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/files-view.test.tsx`
Expected: FAIL — props mismatch.

- [ ] **Step 3: Implement**

In `packages/web/src/views/Files.tsx`, make these changes:

Replace the imports and tab constants at the top:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Api, type FileKind, type FileScope, type FilesListingDto } from '../api.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

const GLOBAL_TABS = [
  ['claudeMd', 'CLAUDE.md'],
  ['agent', 'Agents'],
  ['skill', 'Skills'],
  ['keybindings', 'Keybindings'],
] as const

const PROJECT_TABS = [
  ['claudeMd', 'CLAUDE.md'],
  ['agent', 'Agents'],
  ['skill', 'Skills'],
] as const

type Tab = (typeof GLOBAL_TABS)[number][0]
```

Replace the component signature and the scope plumbing:

```tsx
export function Files({ api, workspace }: { api: Api; workspace: Workspace }) {
  const projectDir = workspaceProjectDir(workspace)
  const tabs = workspace.kind === 'global' ? GLOBAL_TABS : PROJECT_TABS
  const fileScope: FileScope = workspace.kind === 'global' ? 'user' : 'project'
  const [listing, setListing] = useState<FilesListingDto | null>(null)
  const [tab, setTab] = useState<Tab>('claudeMd')
  const [open, setOpen] = useState<Open | null>(null)
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
```

(The `scope` state and its setter are deleted.)

Then apply these mechanical replacements through the rest of the component:

- `const effectiveScope: FileScope = tab === 'keybindings' ? 'user' : scope` → `const scopeFiles = fileScope === 'user' ? listing?.user : listing?.project` (delete the old `effectiveScope`/`scopeFiles` pair; every later use of `effectiveScope` becomes `fileScope`).
- In `openFile`: `scope: fileScope` and `projectDir: fileScope === 'project' ? projectDir : undefined`.
- In `save`: `projectDir: open.scope === 'project' ? projectDir : undefined` (unchanged logic, still correct).
- In `createNew`: `scope: fileScope`.
- Delete `const needsProjectDir = …` and the `needsProjectDir ? (<div className="alert">…</div>) : (…)` wrapper — render the inner fragment unconditionally.
- The tab row maps over `tabs` instead of `TABS`.
- Delete the entire second `scope-picker` block (the user/project row).

The tab row becomes:

```tsx
      <div className="scope-picker">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active projectLocal' : ''}
            onClick={() => {
              if (!confirmDiscard()) return
              setTab(key)
              setOpen(null)
              setDirty(false)
              setMessage(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>
```

In `packages/web/src/App.tsx`, shim the call site — replace:

```tsx
        {view === 'files' && <Files api={api} projectDir={projectDir} />}
```

with:

```tsx
        {view === 'files' && (
          <Files
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
          />
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/files-view.test.tsx && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Files.tsx packages/web/src/App.tsx packages/web/tests/files-view.test.tsx
git commit -m "feat(web): lock file management to its workspace scope"
```

---

### Task 6: MCP workspace conversion

Global lists/creates only `user`-scope servers (no scope select); Project lists `local` + `project` and the form offers exactly those two, defaulting to `local`.

**Files:**
- Modify: `packages/web/src/views/Mcp.tsx`
- Modify: `packages/web/src/App.tsx` (shim)
- Test: `packages/web/tests/mcp-view.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `packages/web/tests/mcp-view.test.tsx` entirely with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows only user-scope servers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} workspace={{ kind: 'global' }} />)
    expect(await screen.findByText('figma')).toBeDefined()
    expect(screen.queryByText('playwright')).toBeNull()
  })

  it('project workspace shows only project-side servers and offers local/project scopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    expect(await screen.findByText('playwright')).toBeDefined()
    expect(screen.queryByText('figma')).toBeNull()

    fireEvent.click(screen.getByText('+ Add server'))
    const scopeSelect = screen.getByDisplayValue(/local \(this project, private\)/)
    expect(scopeSelect).toBeDefined()
    expect(screen.queryByText('user (all projects)')).toBeNull()
  })

  it('does not let extra config smuggle args past a blank args field', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/mcp/add') {
        return Promise.resolve(new Response(JSON.stringify({ via: 'cli' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Mcp api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('figma')

    fireEvent.click(screen.getByText('+ Add server'))
    fireEvent.change(screen.getByPlaceholderText('server-name'), { target: { value: 'srv' } })
    fireEvent.change(screen.getByPlaceholderText('command (e.g. npx)'), {
      target: { value: 'npx' },
    })
    fireEvent.change(
      screen.getByPlaceholderText('extra config JSON, e.g. {"env": {"KEY": "value"}} (optional)'),
      { target: { value: '{"args": ["--evil"]}' } },
    )
    fireEvent.click(screen.getByText('Add server'))

    await screen.findByText(/Added via the claude CLI/)
    const addCall = fetchMock.mock.calls.find(([u]) => u === '/api/mcp/add')!
    const body = JSON.parse(addCall[1].body)
    expect(body.config.args).toEqual([])
    expect(body.scope).toBe('user')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/mcp-view.test.tsx`
Expected: FAIL — props mismatch.

- [ ] **Step 3: Implement**

In `packages/web/src/views/Mcp.tsx`:

Add the workspace import and change the signature/derived state:

```tsx
import { workspaceProjectDir, type Workspace } from '../workspace.js'
```

```tsx
export function Mcp({ api, workspace }: { api: Api; workspace: Workspace }) {
  const projectDir = workspaceProjectDir(workspace)
  const [data, setData] = useState<McpListDto | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    scope: (workspace.kind === 'global' ? 'user' : 'local') as McpScope,
    transport: 'stdio' as Transport,
    command: '',
    args: '',
    url: '',
    extra: '',
  })
```

After the `if (!data)` guard, replace `needsProjectDir` with the visibility filter:

```tsx
  const visibleServers = data.servers.filter((s) =>
    workspace.kind === 'global' ? s.scope === 'user' : s.scope !== 'user',
  )
```

Through the rest of the component:

- Every `data.servers` in the list rendering becomes `visibleServers` (both the `length === 0` check and the `.map`).
- The empty-state copy becomes: `workspace.kind === 'global' ? 'No user-scope MCP servers configured.' : 'No MCP servers configured for this project.'` (drop the old "set a project directory" hint).
- Delete `const needsProjectDir = …`, the `{needsProjectDir && (<div className="alert">…</div>)}` block, and `needsProjectDir` from the Add button's `disabled` expression.
- In the add form, the scope `<select>` renders only in a project workspace, with the two project options:

```tsx
          <div className="edit-row" style={{ gridTemplateColumns: workspace.kind === 'project' ? '1fr 1fr 1fr' : '1fr 1fr' }}>
            <input
              placeholder="server-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {workspace.kind === 'project' && (
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as McpScope })}
              >
                <option value="local">local (this project, private)</option>
                <option value="project">project (shared via .mcp.json)</option>
              </select>
            )}
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
```

- `add()` and `remove()` keep their `projectDir: scope === 'user' ? undefined : projectDir || undefined` logic unchanged — it is still correct because `user` only occurs in Global and `local`/`project` only in a project workspace.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/mcp-view.test.tsx`
Expected: 3 passed. Note the suite will NOT be green yet — App's Mcp call site still passes `projectDir`. Fix the shim now; replace:

```tsx
        {view === 'mcp' && <Mcp api={api} projectDir={projectDir} />}
```

with:

```tsx
        {view === 'mcp' && (
          <Mcp
            api={api}
            workspace={projectDir ? { kind: 'project', dir: projectDir } : { kind: 'global' }}
          />
        )}
```

Then run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/Mcp.tsx packages/web/src/App.tsx packages/web/tests/mcp-view.test.tsx
git commit -m "feat(web): split MCP server management by workspace"
```

---

### Task 7: Dashboard → Overview (global-only)

**Files:**
- Rename: `packages/web/src/views/Dashboard.tsx` → `packages/web/src/views/Overview.tsx`
- Modify: `packages/web/src/App.tsx` (import + call site)
- Test: create `packages/web/tests/overview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/tests/overview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Overview } from '../src/views/Overview.js'

const SETTINGS = {
  entries: [
    { scope: 'user', editable: true, state: { path: '/h/.claude/settings.json', exists: true, value: {} } },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

describe('Overview view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows CLI status and never asks for a project directory', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const payload = url.startsWith('/api/health')
        ? { ok: true, cli: { found: true, version: '2.1.0' } }
        : url.startsWith('/api/backups')
          ? { backups: [] }
          : SETTINGS
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Overview api={new Api('t')} />)
    expect(await screen.findByText('2.1.0')).toBeDefined()
    // settings are fetched without a projectDir — this view is global-only
    const settingsCall = fetchMock.mock.calls.find(([u]) => (u as string).startsWith('/api/settings'))!
    expect(settingsCall[0]).toBe('/api/settings')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/tests/overview.test.tsx`
Expected: FAIL — module `../src/views/Overview.js` not found.

- [ ] **Step 3: Implement**

```bash
git mv packages/web/src/views/Dashboard.tsx packages/web/src/views/Overview.tsx
```

In `packages/web/src/views/Overview.tsx`:
- Rename the component: `export function Overview({ api }: { api: Api }) {`
- Delete the `projectDir` prop and change the settings fetch to `api.settings()` (no argument); the `useEffect` dependency array becomes `[api]`.
- Change the heading `<h2>Dashboard</h2>` to `<h2>Overview</h2>`.

In `packages/web/src/App.tsx`:
- Replace the import `import { Dashboard } from './views/Dashboard.js'` with `import { Overview } from './views/Overview.js'`.
- Replace the call site `{view === 'dashboard' && <Dashboard api={api} projectDir={projectDir} />}` with `{view === 'dashboard' && <Overview api={api} />}` (the nav label stays "Dashboard" until Task 8 replaces the shell).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/overview.test.tsx && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A packages/web/src/views packages/web/src/App.tsx packages/web/tests/overview.test.tsx
git commit -m "refactor(web): dashboard becomes the global-only overview"
```

---

### Task 8: App shell rewrite — two-group sidebar, project picker, workspace routing

**Files:**
- Rewrite: `packages/web/src/App.tsx`
- Test: create `packages/web/tests/app-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/tests/app-shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

const PROJECTS = {
  projects: [
    { dir: '/work/app', name: 'app', exists: true },
    { dir: '/gone/old', name: 'old', exists: false },
  ],
}

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/h/.claude/settings.json', exists: true, raw: '{}', value: {} },
    },
    {
      scope: 'project',
      editable: true,
      state: { path: '/work/app/.claude/settings.json', exists: true, raw: '{"model": "opus"}', value: { model: 'opus' } },
    },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    const payload = url.startsWith('/api/projects')
      ? PROJECTS
      : url.startsWith('/api/health')
        ? { ok: true, cli: { found: true, version: '2.1.0' } }
        : url.startsWith('/api/backups')
          ? { backups: [] }
          : url.startsWith('/api/mcp')
            ? { servers: [], warnings: [] }
            : SETTINGS
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

describe('App shell', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('renders Global and Projects groups with known projects', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    // 'Global' appears in both the nav group title and the breadcrumb
    expect(screen.getAllByText('Global').length).toBeGreaterThan(0)
    expect(screen.getByText('Projects')).toBeDefined()
    expect(await screen.findByText('app')).toBeDefined()
    expect(screen.getByText('old')).toBeDefined()
    // global landing view
    expect(await screen.findByText('Overview', { selector: 'button' })).toBeDefined()
  })

  it('entering a project expands its sub-nav and lands on Effective', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('app'))
    // 'Effective' appears in both the sub-nav and the breadcrumb
    expect((await screen.findAllByText('Effective')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Effective settings')).toBeDefined()
    // persisted
    expect(window.localStorage.getItem('ccs-workspace')).toContain('/work/app')
  })

  it('disables projects whose directory is missing', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const missing = (await screen.findByText('old')).closest('button')!
    expect(missing.disabled).toBe(true)
    expect(screen.getByText('missing')).toBeDefined()
  })

  it('restores the persisted workspace on load', async () => {
    window.localStorage.setItem('ccs-workspace', JSON.stringify({ kind: 'project', dir: '/work/app' }))
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    expect(await screen.findByText('Effective settings')).toBeDefined()
  })

  it('adds a project by path and remembers it as an extra', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    await screen.findByText('app')
    fireEvent.change(screen.getByPlaceholderText('/path/to/project'), {
      target: { value: '/somewhere/new' },
    })
    fireEvent.click(screen.getByText('+ Add project'))
    expect(window.localStorage.getItem('ccs-extra-projects')).toContain('/somewhere/new')
    expect(await screen.findByText('Effective settings')).toBeDefined()
  })

  it('clicking a user-sourced value in Effective jumps to Global settings', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('app'))
    // Effective table: the model row is sourced from the user scope
    fireEvent.click(await screen.findByText('model'))
    expect(await screen.findByDisplayValue('model')).toBeDefined()
    // crumb shows the global workspace
    expect(screen.getAllByText('Global').length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/web/tests/app-shell.test.tsx`
Expected: FAIL — old shell has no Global/Projects groups.

- [ ] **Step 3: Rewrite the shell**

Replace `packages/web/src/App.tsx` entirely with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Api, type ProjectDto } from './api.js'
import { projectName, type Workspace } from './workspace.js'
import { Backups } from './views/Backups.js'
import { Editor, type EditableScope, type EditorJump } from './views/Editor.js'
import { Effective } from './views/Effective.js'
import { Files } from './views/Files.js'
import { Hooks } from './views/Hooks.js'
import { Mcp } from './views/Mcp.js'
import { Overview } from './views/Overview.js'
import { Plugins } from './views/Plugins.js'

const GLOBAL_VIEWS = [
  ['overview', 'Overview'],
  ['settings', 'Settings'],
  ['mcp', 'MCP Servers'],
  ['plugins', 'Plugins'],
  ['files', 'Agents & Files'],
  ['hooks', 'Hooks'],
  ['backups', 'Backups'],
] as const

const PROJECT_VIEWS = [
  ['effective', 'Effective'],
  ['settings', 'Settings'],
  ['mcp', 'MCP Servers'],
  ['files', 'Agents & Files'],
  ['hooks', 'Hooks'],
] as const

type GlobalView = (typeof GLOBAL_VIEWS)[number][0]
type ProjectView = (typeof PROJECT_VIEWS)[number][0]

const WORKSPACE_KEY = 'ccs-workspace'
const EXTRAS_KEY = 'ccs-extra-projects'

function loadWorkspace(): Workspace {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_KEY) ?? 'null') as
      | Workspace
      | null
    if (parsed?.kind === 'project' && typeof parsed.dir === 'string' && parsed.dir !== '') {
      return parsed
    }
  } catch {
    /* corrupted storage falls back to global */
  }
  return { kind: 'global' }
}

function loadExtras(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXTRAS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function App({ token }: { token: string | null }) {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace)
  const [globalView, setGlobalView] = useState<GlobalView>('overview')
  const [projectView, setProjectView] = useState<ProjectView>('effective')
  const [projects, setProjects] = useState<ProjectDto[] | null>(null)
  const [extras, setExtras] = useState<string[]>(loadExtras)
  const [addPath, setAddPath] = useState('')
  const [editorJump, setEditorJump] = useState<EditorJump | null>(null)
  const api = useMemo(() => (token ? new Api(token) : null), [token])

  useEffect(() => {
    if (!api) return
    api
      .listProjects(extras)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]))
  }, [api, extras])

  const onJumpConsumed = useCallback(() => setEditorJump(null), [])

  const jumpToEditor = useCallback((scope: EditableScope, path: string) => {
    setEditorJump({ scope, path })
    if (scope === 'user') {
      setWorkspace({ kind: 'global' })
      window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ kind: 'global' }))
      setGlobalView('settings')
    } else {
      setProjectView('settings')
    }
  }, [])

  if (!api) {
    return (
      <main className="gate">
        <h1 className="wordmark">Claude Code Studio</h1>
        <p>
          No session token found. Start the app from your terminal with{' '}
          <code>npx cc-studio</code> and open the URL it prints — the token rides along in
          that URL.
        </p>
      </main>
    )
  }

  function activate(ws: Workspace) {
    setWorkspace(ws)
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws))
  }

  function openGlobal(view: GlobalView) {
    activate({ kind: 'global' })
    setGlobalView(view)
    setEditorJump(null)
  }

  function openProject(dir: string, view: ProjectView = 'effective') {
    activate({ kind: 'project', dir })
    setProjectView(view)
    setEditorJump(null)
  }

  function saveExtras(next: string[]) {
    setExtras(next)
    window.localStorage.setItem(EXTRAS_KEY, JSON.stringify(next))
  }

  function addProject() {
    const dir = addPath.trim()
    if (!dir) return
    const known = projects?.some((p) => p.dir === dir) ?? false
    if (!known && !extras.includes(dir)) {
      saveExtras([...extras, dir])
    }
    setAddPath('')
    openProject(dir)
  }

  function removeExtra(dir: string) {
    saveExtras(extras.filter((d) => d !== dir))
    if (workspace.kind === 'project' && workspace.dir === dir) {
      openGlobal('overview')
    }
  }

  const activeDir = workspace.kind === 'project' ? workspace.dir : null
  const activeProject = activeDir ? (projects?.find((p) => p.dir === activeDir) ?? null) : null
  const crumbRoot =
    workspace.kind === 'global' ? 'Global' : (activeProject?.name ?? projectName(workspace.dir))
  const crumbTitle =
    workspace.kind === 'global'
      ? GLOBAL_VIEWS.find(([k]) => k === globalView)![1]
      : PROJECT_VIEWS.find(([k]) => k === projectView)![1]

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="wordmark">Claude Code Studio</h1>
        <nav>
          <div className="nav-group-title">Global</div>
          {GLOBAL_VIEWS.map(([key, label]) => (
            <button
              key={key}
              className={
                workspace.kind === 'global' && globalView === key ? 'nav-item active' : 'nav-item'
              }
              onClick={() => openGlobal(key)}
            >
              {label}
            </button>
          ))}

          <div className="nav-group-title">Projects</div>
          {projects === null && <p className="dim nav-note">Loading…</p>}
          {projects?.map((p) => {
            const isActive = activeDir === p.dir
            return (
              <div key={p.dir}>
                <div className="project-row">
                  <button
                    className={isActive ? 'nav-item active' : 'nav-item'}
                    disabled={!p.exists}
                    title={p.dir}
                    onClick={() => openProject(p.dir)}
                  >
                    {/* span wrapper keeps RTL getByText(name) working when the badge is present */}
                    <span className="project-name">{p.name}</span>
                    {!p.exists && <span className="missing-badge">missing</span>}
                  </button>
                  {extras.includes(p.dir) && (
                    <button
                      className="remove-extra"
                      title="Remove from list"
                      onClick={() => removeExtra(p.dir)}
                    >
                      ×
                    </button>
                  )}
                </div>
                {isActive && (
                  <div className="sub-nav">
                    {PROJECT_VIEWS.map(([key, label]) => (
                      <button
                        key={key}
                        className={projectView === key ? 'nav-item active' : 'nav-item'}
                        onClick={() => openProject(p.dir, key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="add-project">
            <input
              placeholder="/path/to/project"
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addProject()
              }}
            />
            <button className="ghost" disabled={!addPath.trim()} onClick={addProject}>
              + Add project
            </button>
          </div>
        </nav>
      </aside>
      <main className="content">
        <div className="topbar">
          <span className="crumb">{crumbRoot}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb current">{crumbTitle}</span>
        </div>
        {workspace.kind === 'project' && activeProject && !activeProject.exists && (
          <div className="alert error">
            This project directory no longer exists on disk: {workspace.dir}
          </div>
        )}
        {workspace.kind === 'global' ? (
          <>
            {globalView === 'overview' && <Overview api={api} />}
            {globalView === 'settings' && (
              <Editor
                api={api}
                workspace={workspace}
                jump={editorJump}
                onJumpConsumed={onJumpConsumed}
              />
            )}
            {globalView === 'mcp' && <Mcp api={api} workspace={workspace} />}
            {globalView === 'plugins' && <Plugins api={api} />}
            {globalView === 'files' && <Files api={api} workspace={workspace} />}
            {globalView === 'hooks' && <Hooks api={api} workspace={workspace} onEdit={jumpToEditor} />}
            {globalView === 'backups' && <Backups api={api} />}
          </>
        ) : (
          // key remounts every project view on switch, resetting per-project state
          <div key={workspace.dir}>
            {projectView === 'effective' && (
              <Effective api={api} projectDir={workspace.dir} onEdit={jumpToEditor} />
            )}
            {projectView === 'settings' && (
              <Editor
                api={api}
                workspace={workspace}
                jump={editorJump}
                onJumpConsumed={onJumpConsumed}
              />
            )}
            {projectView === 'mcp' && <Mcp api={api} workspace={workspace} />}
            {projectView === 'files' && <Files api={api} workspace={workspace} />}
            {projectView === 'hooks' && <Hooks api={api} workspace={workspace} onEdit={jumpToEditor} />}
          </div>
        )}
      </main>
    </div>
  )
}
```

Notes: the v1 `ccs-project-dir` localStorage key is retired (no migration — it was a free-text path). `Effective` keeps its `projectDir` prop unchanged; it only ever renders inside a project.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/tests/app-shell.test.tsx && npx vitest run`
Expected: all green. Also confirm types/build: `npm run build` at the repo root.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/tests/app-shell.test.tsx
git commit -m "feat(web): two-workspace shell with project picker fed by Claude's project list"
```

---

### Task 9: Visual redesign — Inter chrome, mono for data, card system

No behavior changes: this task only touches the stylesheet, fonts, and `main.tsx` imports, so the existing test suite is the regression net (no new tests).

**Files:**
- Modify: `packages/web/package.json` (dependency)
- Modify: `packages/web/src/main.tsx`
- Rewrite: `packages/web/src/styles.css`

- [ ] **Step 1: Add the font dependency**

```bash
npm install @fontsource/inter@^5 -w @claude-code-studio/web
```

- [ ] **Step 2: Import the font weights**

In `packages/web/src/main.tsx`, add above the IBM Plex Mono imports:

```tsx
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
```

- [ ] **Step 3: Replace the stylesheet**

Replace `packages/web/src/styles.css` entirely with:

```css
:root {
  color-scheme: dark;
  --bg: #0e1012;
  --bg-raised: #16181c;
  --bg-inset: #0a0c0e;
  --line: rgba(255, 255, 255, 0.08);
  --line-strong: rgba(255, 255, 255, 0.16);
  --ink: #ededf0;
  --ink-dim: #8b8d98;
  --accent: #ffb454;
  --accent-soft: rgba(255, 180, 84, 0.12);
  --scope-user: #6fd0bd;
  --scope-project: #a3cf6b;
  --scope-projectLocal: #ffb454;
  --scope-managed: #e0705e;
  --diff-add: #a3cf6b;
  --diff-del: #e0705e;
  --sans: 'Inter', system-ui, -apple-system, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --serif: 'Instrument Serif', serif;
  --radius: 8px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.6;
  min-height: 100vh;
}

code,
pre {
  font-family: var(--mono);
}

.wordmark {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  font-size: 1.45rem;
  letter-spacing: 0.01em;
  margin: 0 0 1.75rem;
  color: var(--ink);
}

.wordmark::after {
  content: '_';
  color: var(--accent);
}

/* ---- shell ---- */

.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: var(--bg-inset);
  padding: 1.75rem 1rem;
  overflow-y: auto;
}

.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-group-title {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin: 1.25rem 0 0.4rem 0.6rem;
}

.nav-group-title:first-child {
  margin-top: 0;
}

.nav-item {
  font: inherit;
  font-size: 0.86rem;
  text-align: left;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--ink-dim);
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-item:hover:not(:disabled) {
  color: var(--ink);
  background: var(--bg-raised);
}

.nav-item.active {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 500;
}

.nav-item:disabled {
  opacity: 0.45;
  cursor: default;
}

.nav-note {
  margin: 0.25rem 0.6rem;
  font-size: 0.8rem;
}

.project-row {
  display: flex;
  align-items: center;
}

.remove-extra {
  font: inherit;
  background: none;
  border: none;
  color: var(--ink-dim);
  cursor: pointer;
  padding: 0 0.4rem;
}

.remove-extra:hover {
  color: var(--scope-managed);
}

.sub-nav {
  margin: 2px 0 4px 0.85rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sub-nav .nav-item {
  font-size: 0.82rem;
  padding: 0.3rem 0.55rem;
}

.missing-badge {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--scope-managed);
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 0.4rem;
}

.add-project {
  margin: 0.75rem 0.1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.add-project input {
  font-family: var(--mono);
  font-size: 0.75rem;
}

/* ---- content ---- */

.content {
  padding: 1.5rem 2.5rem 3rem;
  max-width: 960px;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 1rem;
  margin-bottom: 1.75rem;
  border-bottom: 1px solid var(--line);
  font-size: 0.82rem;
}

.crumb {
  color: var(--ink-dim);
}

.crumb-sep {
  color: var(--ink-dim);
  opacity: 0.5;
}

.crumb.current {
  color: var(--ink);
  font-weight: 500;
}

.content h2 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 1rem;
}

.dim {
  color: var(--ink-dim);
}

.gate {
  max-width: 32rem;
  margin: 18vh auto;
  padding: 0 2rem;
}

/* ---- controls ---- */

input,
select,
textarea {
  font-family: var(--mono);
  font-size: 0.82rem;
  color: var(--ink);
  background: var(--bg-inset);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
}

input:focus,
select:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

button.action {
  font: inherit;
  font-weight: 600;
  font-size: 0.84rem;
  color: #1a1205;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1.1rem;
  cursor: pointer;
}

button.action:hover:not(:disabled) {
  filter: brightness(1.08);
}

button.action:disabled {
  opacity: 0.45;
  cursor: default;
}

button.ghost {
  font: inherit;
  font-size: 0.84rem;
  color: var(--ink-dim);
  background: none;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 0.42rem 0.9rem;
  cursor: pointer;
}

button.ghost:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--ink-dim);
  background: var(--bg-raised);
}

button.ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ---- badges & scope colors ---- */

.badge {
  display: inline-block;
  font-family: var(--sans);
  font-size: 0.68rem;
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

/* ---- tables ---- */

table.kv {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

table.kv th {
  text-align: left;
  color: var(--ink-dim);
  font-weight: 500;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--line);
  padding: 0.55rem 0.85rem;
}

table.kv td {
  border-bottom: 1px solid var(--line);
  padding: 0.55rem 0.85rem;
  vertical-align: top;
}

table.kv tr:last-child td {
  border-bottom: none;
}

table.kv tr:hover td {
  background: rgba(255, 255, 255, 0.02);
}

table.kv td.path {
  font-family: var(--mono);
  color: var(--accent);
  white-space: nowrap;
}

table.kv td.value {
  font-family: var(--mono);
  word-break: break-all;
}

/* ---- cards ---- */

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.card {
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.2rem;
}

.card .label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin-bottom: 0.35rem;
}

.card .figure {
  font-family: var(--mono);
  font-size: 1.4rem;
  font-weight: 600;
}

.card .figure.ok { color: var(--scope-project); }
.card .figure.bad { color: var(--scope-managed); }

/* ---- code & diffs ---- */

pre.code,
pre.diff {
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-size: 0.8rem;
  line-height: 1.55;
}

pre.diff .add { color: var(--diff-add); }
pre.diff .del { color: var(--diff-del); }
pre.diff .meta { color: var(--ink-dim); }

/* ---- alerts ---- */

.alert {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  background: var(--bg-raised);
  border-radius: 6px;
  padding: 0.7rem 1rem;
  margin: 1rem 0;
  font-size: 0.85rem;
}

.alert.error { border-left-color: var(--scope-managed); }
.alert.ok { border-left-color: var(--scope-project); }

/* ---- forms & rows ---- */

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
  font-size: 0.78rem;
  font-weight: 500;
  background: none;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--ink-dim);
  padding: 0.3rem 0.9rem;
  cursor: pointer;
}

.scope-picker button:hover {
  color: var(--ink);
}

.scope-picker button.active.user { color: var(--scope-user); border-color: var(--scope-user); }
.scope-picker button.active.project { color: var(--scope-project); border-color: var(--scope-project); }
.scope-picker button.active.projectLocal { color: var(--scope-projectLocal); border-color: var(--scope-projectLocal); }
.scope-picker button.active.managed { color: var(--scope-managed); border-color: var(--scope-managed); }

textarea {
  line-height: 1.6;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run build`
Expected: full suite green; web build succeeds. Then eyeball it live: `node packages/server/dist/bin.js` after the build (or `npm run dev -w @claude-code-studio/web` against a running server) and confirm the sidebar groups, project sub-nav, badges, diff colors, and managed tab all render on the new theme.

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json package-lock.json packages/web/src/main.tsx packages/web/src/styles.css
git commit -m "feat(web): modern dashboard theme with Inter chrome and mono data"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full suite + build from a clean slate**

```bash
npx vitest run
npm run build
```

Expected: every test green (137 pre-existing, now updated, plus ~18 new); `tsc -b` and `vite build` succeed; the server bundle step completes.

- [ ] **Step 2: Smoke the packaged path**

```bash
node packages/server/dist/bin.js
```

Open the printed URL. Verify: project list shows real projects from `~/.claude.json`; entering one lands on Effective; Global settings shows user + managed tabs; a project's settings shows project + projectLocal only; "+ Add project" with a junk path shows it grayed with "missing" and a × to remove it. Ctrl-C the server when done.

- [ ] **Step 3: Commit anything outstanding**

```bash
git status --short
```

Expected: clean (every task committed as it went). If anything is left, commit it with an accurate message.
