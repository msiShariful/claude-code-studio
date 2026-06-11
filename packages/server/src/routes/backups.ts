import { listBackups, restoreBackup } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server.js'

export function backupsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/backups', async () => {
    return { backups: await listBackups(ctx.backupsRoot) }
  })

  app.post<{ Body: { backupPath?: string } }>('/api/backups/restore', async (req, reply) => {
    const backupPath = req.body?.backupPath
    const all = await listBackups(ctx.backupsRoot)
    const entry = all.find((b) => b.backupPath === backupPath)
    if (!entry) return reply.code(404).send({ error: 'unknown backup' })
    await restoreBackup(entry)
    return { restored: true, originalPath: entry.originalPath }
  })
}
