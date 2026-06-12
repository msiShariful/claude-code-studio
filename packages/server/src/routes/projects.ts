import { readJsonFile } from '@claude-code-studio/core'
import type { FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { ServerContext } from '../server.js'

interface ProjectsQuery {
  extra?: string
}

/**
 * Lists the project directories Claude Code itself knows about (the keys of
 * `projects` in ~/.claude.json) plus any client-supplied extras. Read-only:
 * extras only ever hit existsSync — never a file read or write.
 */
export function projectsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/api/projects', async (req) => {
    const { extra } = req.query as ProjectsQuery
    const state = await readJsonFile(ctx.globalPaths.claudeJson)
    const projectsValue = state.value?.projects
    const known =
      typeof projectsValue === 'object' && projectsValue !== null && !Array.isArray(projectsValue)
        ? Object.keys(projectsValue)
        : []
    const extras = (extra ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !known.includes(s))
    const projects = [...known, ...new Set(extras)].map((dir) => ({
      dir,
      name: basename(dir),
      exists: existsSync(dir),
    }))
    return { projects }
  })
}
