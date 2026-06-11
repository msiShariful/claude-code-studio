import { detectCli } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'

export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    return { ok: true, cli: await detectCli() }
  })
}
