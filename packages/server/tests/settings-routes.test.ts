import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
