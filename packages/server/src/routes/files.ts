import {
  backupFile,
  getProjectPaths,
  listManagedFiles,
  readTextFile,
  resolveManagedFile,
  WriteConflictError,
  writeTextFileAtomic,
  type FileKind,
  type FileScope,
  type ManagedFileRef,
} from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { isAbsolute } from 'node:path'
import type { ServerContext } from '../server.js'

const KINDS: ReadonlySet<string> = new Set(['claudeMd', 'keybindings', 'agent', 'skill'])
const SCOPES: ReadonlySet<string> = new Set(['user', 'project'])

interface RefQuery {
  kind?: string
  scope?: string
  name?: string
  projectDir?: string
}

function parseRef(q: RefQuery): { error?: string; ref?: ManagedFileRef; projectDir?: string } {
  if (!q.kind || !KINDS.has(q.kind)) return { error: 'invalid kind' }
  if (!q.scope || !SCOPES.has(q.scope)) return { error: 'invalid scope' }
  if (q.scope === 'project') {
    if (!q.projectDir) return { error: 'projectDir is required for the project scope' }
    if (!isAbsolute(q.projectDir)) return { error: 'projectDir must be an absolute path' }
  }
  return {
    ref: { kind: q.kind as FileKind, scope: q.scope as FileScope, name: q.name },
    projectDir: q.projectDir,
  }
}

export function filesRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get<{ Querystring: { projectDir?: string } }>('/api/files', async (req, reply) => {
    const { projectDir } = req.query
    if (projectDir && !isAbsolute(projectDir)) {
      return reply.code(400).send({ error: 'projectDir must be an absolute path' })
    }
    return listManagedFiles(ctx.globalPaths, projectDir ? getProjectPaths(projectDir) : undefined)
  })

  app.get<{ Querystring: RefQuery }>('/api/files/read', async (req, reply) => {
    const { error, ref, projectDir } = parseRef(req.query)
    if (error) return reply.code(400).send({ error })
    let path: string
    try {
      path = resolveManagedFile(
        ref!,
        ctx.globalPaths,
        projectDir ? getProjectPaths(projectDir) : undefined,
      )
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    const state = await readTextFile(path)
    return { path: state.path, exists: state.exists, content: state.content ?? '', hash: state.hash ?? null }
  })

  app.post<{
    Body: RefQuery & { content?: unknown; expectedHash?: unknown }
  }>('/api/files/save', async (req, reply) => {
    const body = req.body ?? {}
    const { error, ref, projectDir } = parseRef(body)
    if (error) return reply.code(400).send({ error })
    if (typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' })
    }
    if (typeof body.expectedHash !== 'string' && body.expectedHash !== null) {
      return reply.code(400).send({ error: 'expectedHash must be a string or null' })
    }
    let path: string
    try {
      path = resolveManagedFile(
        ref!,
        ctx.globalPaths,
        projectDir ? getProjectPaths(projectDir) : undefined,
      )
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    try {
      await backupFile(path, ctx.backupsRoot)
      const state = await writeTextFileAtomic(path, body.content, {
        expectedHash: body.expectedHash,
      })
      return { saved: true, path: state.path, hash: state.hash }
    } catch (err) {
      if (err instanceof WriteConflictError) {
        return reply.code(409).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
