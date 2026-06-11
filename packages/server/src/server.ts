import { getBackupsRoot, getGlobalPaths, type GlobalPaths } from '@claude-code-studio/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerSecurity, requireBearerToken } from './auth.js'
import { backupsRoutes } from './routes/backups.js'
import { healthRoutes } from './routes/health.js'
import { settingsRoutes } from './routes/settings.js'

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
  if (!opts.token) {
    throw new Error('token must be a non-empty string')
  }
  const ctx: ServerContext = {
    globalPaths: opts.globalPaths ?? getGlobalPaths(),
    backupsRoot: opts.backupsRoot ?? getBackupsRoot(),
  }
  const app = Fastify({ logger: false })
  registerSecurity(app)
  app.get('/', async (_req, reply) => {
    return reply
      .type('text/html')
      .send(
        '<!doctype html><html><body><h1>Claude Code Studio</h1><p>The web UI ships in a later milestone. The API is running.</p></body></html>',
      )
  })
  // All API routes live in this encapsulated context; the token hook is
  // bound to matched routes, not URL prefixes (see auth.ts for why).
  // void is safe here: app.listen()/app.inject() both await app.ready(),
  // which guarantees plugin registration completes before requests are served.
  void app.register(async (api) => {
    api.addHook('onRequest', requireBearerToken(opts.token))
    healthRoutes(api)
    settingsRoutes(api, ctx)
    backupsRoutes(api, ctx)
  })
  return app
}
