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
