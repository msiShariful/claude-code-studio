import {
  getProjectPaths,
  readSettingsFiles,
  resolveEffectiveSettings,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

export async function readEntriesFor(ctx: ServerContext, projectDir?: string) {
  const project = projectDir ? getProjectPaths(projectDir) : undefined
  return readSettingsFiles(ctx.globalPaths, project)
}

export function settingsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/settings', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    const entries = await readEntriesFor(ctx, projectDir)
    return { entries, effective: resolveEffectiveSettings(entries) }
  })
}
