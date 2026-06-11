import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { backupFile } from '@claude-code-studio/core'
import { fixture } from './settings-routes.test.js'

const TOKEN = 't-test-token'
const auth = { authorization: `Bearer ${TOKEN}` }

describe('backups routes', () => {
  it('lists backups newest-first', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.settings, '{"v": 1}')
    await backupFile(globalPaths.settings, backupsRoot)
    const res = await app.inject({ url: '/api/backups', headers: auth })
    expect(res.statusCode).toBe(200)
    const { backups } = res.json()
    expect(backups).toHaveLength(1)
    expect(backups[0].originalPath).toBe(globalPaths.settings)
  })

  it('restores a known backup and rejects unknown paths', async () => {
    const { app, globalPaths, backupsRoot } = await fixture()
    await writeFile(globalPaths.settings, '{"v": 1}')
    const entry = await backupFile(globalPaths.settings, backupsRoot)
    await writeFile(globalPaths.settings, '{"v": 2}') // user breaks the file

    const ok = await app.inject({
      method: 'POST',
      url: '/api/backups/restore',
      headers: auth,
      payload: { backupPath: entry!.backupPath },
    })
    expect(ok.statusCode).toBe(200)
    expect(await readFile(globalPaths.settings, 'utf8')).toBe('{"v": 1}')

    const bad = await app.inject({
      method: 'POST',
      url: '/api/backups/restore',
      headers: auth,
      payload: { backupPath: '/etc/passwd' },
    })
    expect(bad.statusCode).toBe(404)
  })
})
