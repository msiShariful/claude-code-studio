import {
  listAvailablePlugins,
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
  type CliRunResult,
  type MarketplaceActionName,
  type PluginActionName,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import type { ServerContext } from '../server.js'

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function sendCliResult(result: CliRunResult, reply: { code(n: number): { send(b: unknown): unknown } }) {
  if (result.exitCode !== 0) {
    return reply.code(400).send({
      error: result.stderr || result.stdout || 'claude CLI failed',
      command: result.command,
    })
  }
  return { ok: true, output: result.stdout }
}

export function pluginsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/plugins', async () => {
    try {
      const [plugins, marketplaces] = await Promise.all([
        listPlugins(ctx.runner),
        listMarketplaces(ctx.runner),
      ])
      return { cliFound: true, plugins, marketplaces }
    } catch (err) {
      if (isMissingBinary(err)) {
        return { cliFound: false, plugins: [], marketplaces: [] }
      }
      throw err
    }
  })

  app.get('/api/plugins/available', async () => {
    try {
      const marketplaces = await listMarketplaces(ctx.runner)
      return { cliFound: true, available: await listAvailablePlugins(marketplaces) }
    } catch (err) {
      if (isMissingBinary(err)) {
        return { cliFound: false, available: [] }
      }
      throw err
    }
  })

  app.post<{ Body: { action?: PluginActionName; plugin?: string } }>(
    '/api/plugins/action',
    async (req, reply) => {
      const { action, plugin } = req.body ?? {}
      if (typeof action !== 'string' || typeof plugin !== 'string') {
        return reply.code(400).send({ error: 'action and plugin are required' })
      }
      try {
        return sendCliResult(await pluginAction(ctx.runner, action, plugin), reply)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )

  app.post<{ Body: { action?: MarketplaceActionName; value?: string } }>(
    '/api/plugins/marketplace',
    async (req, reply) => {
      const { action, value } = req.body ?? {}
      if (typeof action !== 'string' || typeof value !== 'string') {
        return reply.code(400).send({ error: 'action and value are required' })
      }
      try {
        return sendCliResult(await marketplaceAction(ctx.runner, action, value), reply)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )
}
