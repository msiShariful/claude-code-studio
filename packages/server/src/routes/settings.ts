import {
  applyChange,
  getProjectPaths,
  planJsonUpdate,
  pruneBackups,
  readSettingsFiles,
  resolveEffectiveSettings,
  WriteConflictError,
  type SettingsEdit,
  type SettingsScope,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

interface ScopeTargetBody {
  scope: SettingsScope
  projectDir?: string
  edits: SettingsEdit[]
}

const EDITABLE_SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'projectLocal'])

export async function readEntriesFor(ctx: ServerContext, projectDir?: string) {
  const project = projectDir ? getProjectPaths(projectDir) : undefined
  return readSettingsFiles(ctx.globalPaths, project)
}

function validateTarget(body: unknown): { error?: string; target?: ScopeTargetBody } {
  if (!body || typeof body !== 'object') return { error: 'invalid body' }
  const b = body as ScopeTargetBody
  if (!EDITABLE_SCOPES.has(b.scope)) return { error: `scope "${String(b.scope)}" is not editable` }
  if (b.scope !== 'user') {
    if (!b.projectDir) return { error: 'projectDir is required for project scopes' }
    if (!isAbsolute(b.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  if (!Array.isArray(b.edits) || b.edits.length === 0) {
    return { error: 'edits must be a non-empty array' }
  }
  return { target: b }
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

  app.post('/api/settings/preview', async (req, reply) => {
    const { error, target } = validateTarget(req.body)
    if (error) return reply.code(400).send({ error })
    const entries = await readEntriesFor(ctx, target!.projectDir)
    const entry = entries.find((e) => e.scope === target!.scope)!
    try {
      return planJsonUpdate(entry.state, target!.edits)
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.post<{ Body: { expectedHash: string | null } }>(
    '/api/settings/apply',
    async (req, reply) => {
      const { error, target } = validateTarget(req.body)
      if (error) return reply.code(400).send({ error })
      const entries = await readEntriesFor(ctx, target!.projectDir)
      const entry = entries.find((e) => e.scope === target!.scope)!
      let change
      try {
        change = planJsonUpdate(entry.state, target!.edits)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
      if (change.expectedHash !== req.body.expectedHash) {
        return reply
          .code(409)
          .send({ error: 'file changed since preview', code: 'WRITE_CONFLICT' })
      }
      try {
        const state = await applyChange(change, ctx.backupsRoot)
        await pruneBackups(ctx.backupsRoot)
        return { applied: true, state, diff: change.diff }
      } catch (err) {
        if (err instanceof WriteConflictError) {
          return reply.code(409).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )
}
