import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBackups } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

describe('/api/files', () => {
  it('requires auth on every files route', async () => {
    const { app } = await fixture()
    for (const inject of [
      { url: '/api/files' },
      { url: '/api/files/read?kind=claudeMd&scope=user' },
      {
        method: 'POST' as const,
        url: '/api/files/save',
        payload: { kind: 'claudeMd', scope: 'user', content: 'x', expectedHash: null },
      },
    ]) {
      const res = await app.inject(inject)
      expect(res.statusCode).toBe(401)
    }
  })

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
