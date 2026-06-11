import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths } from '@claude-code-studio/core'
import { createToken } from '../src/config.js'
import { buildServer } from '../src/server.js'

describe('e2e over real HTTP', () => {
  it('boots on an ephemeral port and serves the full preview/apply/restore flow', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ccs-e2e-'))
    const globalPaths = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
    await mkdir(globalPaths.configDir, { recursive: true })
    await writeFile(globalPaths.settings, '{"model": "opus"}')
    const backupsRoot = join(home, 'backups')
    const token = createToken()
    const app = buildServer({ token, globalPaths, backupsRoot })
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    try {
      // no token → 401
      const noAuth = await fetch(`${address}/api/health`)
      expect(noAuth.status).toBe(401)

      // health
      const health = await fetch(`${address}/api/health`, { headers: auth })
      expect(health.status).toBe(200)

      // preview → apply
      const preview = await fetch(`${address}/api/settings/preview`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ scope: 'user', edits: [{ path: 'model', value: 'sonnet' }] }),
      })
      expect(preview.status).toBe(200)
      const { expectedHash } = (await preview.json()) as { expectedHash: string }
      const apply = await fetch(`${address}/api/settings/apply`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          scope: 'user',
          edits: [{ path: 'model', value: 'sonnet' }],
          expectedHash,
        }),
      })
      expect(apply.status).toBe(200)
      expect(JSON.parse(await readFile(globalPaths.settings, 'utf8'))).toEqual({ model: 'sonnet' })

      // backups → restore
      const backups = await fetch(`${address}/api/backups`, { headers: auth })
      const { backups: list } = (await backups.json()) as {
        backups: Array<{ backupPath: string }>
      }
      expect(list).toHaveLength(1)
      const restore = await fetch(`${address}/api/backups/restore`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ backupPath: list[0].backupPath }),
      })
      expect(restore.status).toBe(200)
      expect(JSON.parse(await readFile(globalPaths.settings, 'utf8'))).toEqual({ model: 'opus' })
    } finally {
      await app.close()
    }
  })
})
