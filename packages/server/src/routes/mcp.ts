import {
  addMcpServer,
  MCP_SCOPES,
  readMcpHealth,
  readMcpServers,
  removeMcpServer,
  type McpScope,
  type McpServerConfig,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

interface McpBody {
  name: string
  scope: McpScope
  config?: McpServerConfig
  projectDir?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validate(body: unknown, needsConfig: boolean): { error?: string; target?: McpBody } {
  if (!isPlainObject(body)) return { error: 'invalid body' }
  const b = body as unknown as McpBody
  if (typeof b.name !== 'string') return { error: 'name is required' }
  if (!MCP_SCOPES.includes(b.scope)) return { error: `scope must be one of ${MCP_SCOPES.join(', ')}` }
  if (b.scope !== 'user') {
    if (!b.projectDir) return { error: 'projectDir is required for this scope' }
    if (!isAbsolute(b.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  if (needsConfig && !isPlainObject(b.config)) return { error: 'config must be an object' }
  return { target: b }
}

export function mcpRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/mcp', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    return readMcpServers(ctx.globalPaths, projectDir)
  })

  app.get<{ Querystring: { projectDir?: string } }>('/api/mcp/health', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    return readMcpHealth(ctx.runner, projectDir)
  })

  app.post('/api/mcp/add', async (req, reply) => {
    const { error, target } = validate(req.body, true)
    if (error) return reply.code(400).send({ error })
    try {
      const result = await addMcpServer(
        { name: target!.name, scope: target!.scope, config: target!.config! },
        {
          global: ctx.globalPaths,
          projectDir: target!.projectDir,
          backupsRoot: ctx.backupsRoot,
          runner: ctx.runner,
        },
      )
      if (result.result && result.result.exitCode !== 0) {
        return reply.code(400).send({
          error: result.result.stderr || result.result.stdout || 'claude mcp failed',
          command: result.result.command,
        })
      }
      return result
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.post('/api/mcp/remove', async (req, reply) => {
    const { error, target } = validate(req.body, false)
    if (error) return reply.code(400).send({ error })
    try {
      const result = await removeMcpServer(
        { name: target!.name, scope: target!.scope },
        {
          global: ctx.globalPaths,
          projectDir: target!.projectDir,
          backupsRoot: ctx.backupsRoot,
          runner: ctx.runner,
        },
      )
      if (result.result && result.result.exitCode !== 0) {
        return reply.code(400).send({
          error: result.result.stderr || result.result.stdout || 'claude mcp failed',
          command: result.result.command,
        })
      }
      return result
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
