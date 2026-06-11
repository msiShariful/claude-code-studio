import { detectCli, type CliInfo } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'

let cachedCli: CliInfo | undefined

export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    // detectCli spawns a child process; cache for the server's lifetime.
    cachedCli ??= await detectCli()
    return { ok: true, cli: cachedCli }
  })
}
