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
