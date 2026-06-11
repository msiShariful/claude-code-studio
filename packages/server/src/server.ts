import { getBackupsRoot, getGlobalPaths, type GlobalPaths } from '@claude-code-studio/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.js'
import { healthRoutes } from './routes/health.js'

export interface BuildOptions {
  token: string
  globalPaths?: GlobalPaths
  backupsRoot?: string
}

export interface ServerContext {
  globalPaths: GlobalPaths
  backupsRoot: string
}

export function buildServer(opts: BuildOptions): FastifyInstance {
  const ctx: ServerContext = {
    globalPaths: opts.globalPaths ?? getGlobalPaths(),
    backupsRoot: opts.backupsRoot ?? getBackupsRoot(),
  }
  const app = Fastify({ logger: false })
  registerAuth(app, opts.token)
  app.get('/', async (_req, reply) => {
    return reply
      .type('text/html')
      .send(
        '<!doctype html><html><body><h1>Claude Code Studio</h1><p>The web UI ships in a later milestone. The API is running.</p></body></html>',
      )
  })
  healthRoutes(app)
  void ctx // settings/backups routes attach in later tasks
  return app
}
