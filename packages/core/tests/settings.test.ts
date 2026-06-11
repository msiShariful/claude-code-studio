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
