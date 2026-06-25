import { getBackupsRoot, getGlobalPaths, runCommand, type CliRunner, type GlobalPaths } from '@claude-code-studio/core'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerSecurity, requireBearerToken } from './auth.js'
import { backupsRoutes } from './routes/backups.js'
import { filesRoutes } from './routes/files.js'
import { healthRoutes } from './routes/health.js'
import { mcpRoutes } from './routes/mcp.js'
import { pluginsRoutes } from './routes/plugins.js'
import { projectsRoutes } from './routes/projects.js'
import { settingsRoutes } from './routes/settings.js'
import { usageRoutes } from './routes/usage.js'

export interface BuildOptions {
  token: string
  globalPaths?: GlobalPaths
  backupsRoot?: string
  /** Directory containing the built SPA (index.html + assets). Optional: without it a placeholder page is served. */
  webRoot?: string
  /** Injectable for tests; defaults to the real runCommand. */
  runner?: CliRunner
}

export interface ServerContext {
  globalPaths: GlobalPaths
  backupsRoot: string
  runner: CliRunner
}

export function buildServer(opts: BuildOptions): FastifyInstance {
  if (!opts.token) {
    throw new Error('token must be a non-empty string')
  }
  const ctx: ServerContext = {
    globalPaths: opts.globalPaths ?? getGlobalPaths(),
    backupsRoot: opts.backupsRoot ?? getBackupsRoot(),
    runner: opts.runner ?? runCommand,
  }
  const app = Fastify({ logger: false })
  registerSecurity(app)
  const webRoot = opts.webRoot
  if (webRoot && existsSync(join(webRoot, 'index.html'))) {
    void app.register(fastifyStatic, { root: webRoot })
    app.setNotFoundHandler((req, reply) => {
      // Fail-closed string check: an encoded /api path would merely get
      // index.html instead of a JSON 404 — auth never depends on this.
      if (req.method !== 'GET' || req.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.get('/', async (_req, reply) => {
      return reply
        .type('text/html')
        .send(
          '<!doctype html><html><body><h1>Claude Code Studio</h1><p>The web UI ships in a later milestone. The API is running.</p></body></html>',
        )
    })
  }
  // All API routes live in this encapsulated context; the token hook is
  // bound to matched routes, not URL prefixes (see auth.ts for why).
  // void is safe here: app.listen()/app.inject() both await app.ready(),
  // which guarantees plugin registration completes before requests are served.
  void app.register(async (api) => {
    api.addHook('onRequest', requireBearerToken(opts.token))
    healthRoutes(api)
    settingsRoutes(api, ctx)
    backupsRoutes(api, ctx)
    mcpRoutes(api, ctx)
    pluginsRoutes(api, ctx)
    filesRoutes(api, ctx)
    projectsRoutes(api, ctx)
    usageRoutes(api, ctx)
  })
  return app
}
