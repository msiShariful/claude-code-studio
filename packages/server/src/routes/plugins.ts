import {
  listAvailablePlugins,
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
  readProjectEnabledPlugins,
  type CliRunResult,
  type MarketplaceActionName,
  type PluginActionName,
  type PluginScope,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

const PLUGIN_SCOPES: readonly PluginScope[] = ['user', 'project', 'local']

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
  app.get<{ Querystring: { projectDir?: string } }>('/api/plugins', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    // Per-project overrides come from the project's own settings files, not the CLI,
    // so they're available even when the claude binary is absent.
    const projectEnabled = projectDir ? await readProjectEnabledPlugins(projectDir) : undefined
    try {
      const [plugins, marketplaces] = await Promise.all([
        listPlugins(ctx.runner),
        listMarketplaces(ctx.runner),
      ])
      return { cliFound: true, plugins, marketplaces, ...(projectEnabled && { projectEnabled }) }
    } catch (err) {
      if (isMissingBinary(err)) {
        return { cliFound: false, plugins: [], marketplaces: [], ...(projectEnabled && { projectEnabled }) }
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

  app.post<{ Body: { action?: PluginActionName; plugin?: string; scope?: PluginScope; projectDir?: string } }>(
    '/api/plugins/action',
    async (req, reply) => {
      const { action, plugin, scope, projectDir } = req.body ?? {}
      if (typeof action !== 'string' || typeof plugin !== 'string') {
        return reply.code(400).send({ error: 'action and plugin are required' })
      }
      if (scope !== undefined && !PLUGIN_SCOPES.includes(scope)) {
        return reply.code(400).send({ error: `scope must be one of ${PLUGIN_SCOPES.join(', ')}` })
      }
      // project/local scope writes to that project's settings, so we must run the
      // CLI in the project directory — require an absolute path for it.
      if (scope === 'project' || scope === 'local') {
        if (!projectDir) return reply.code(400).send({ error: 'projectDir is required for this scope' })
        if (!isAbsolute(projectDir)) return reply.code(400).send({ error: 'projectDir must be an absolute path' })
      }
      try {
        const cwd = scope === 'project' || scope === 'local' ? projectDir : undefined
        return sendCliResult(await pluginAction(ctx.runner, action, plugin, { scope, cwd }), reply)
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
