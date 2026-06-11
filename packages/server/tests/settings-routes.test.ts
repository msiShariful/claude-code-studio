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
