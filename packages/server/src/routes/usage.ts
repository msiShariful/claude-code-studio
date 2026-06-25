import {
  blocksData,
  dailyData,
  historyData,
  liveData,
  loadAll,
  modelsData,
  monthlyData,
  overviewData,
  projectsData,
  sessionData,
  statsData,
  todayData,
} from '@claude-code-studio/usage'
import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import type { ServerContext } from '../server.js'

interface UsageQuery {
  since?: string
  until?: string
  limit?: string
  sort?: string
  period?: string
  project?: string
}

/** Whitelist the query params that are safe to pass through to the engine. */
function pickOpts(q: UsageQuery) {
  const opts: { since?: string; until?: string; limit?: number; sort?: string; project?: string } = {}
  if (q.since) opts.since = q.since
  if (q.until) opts.until = q.until
  if (q.limit) opts.limit = Number(q.limit)
  if (q.sort) opts.sort = q.sort
  if (q.project) opts.project = q.project
  return opts
}

export function usageRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // The JSONL transcripts Claude Code writes, machine-wide. Re-read each request
  // so a freshly-finished turn shows up without restarting the server.
  const projectsDir = join(ctx.globalPaths.configDir, 'projects')

  app.get<{ Querystring: UsageQuery }>('/api/usage/overview', async () => overviewData(loadAll(projectsDir)))
  app.get<{ Querystring: UsageQuery }>('/api/usage/today', async () => todayData(loadAll(projectsDir)))
  app.get<{ Querystring: UsageQuery }>('/api/usage/daily', async (req) =>
    dailyData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/monthly', async (req) =>
    monthlyData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/stats', async (req) =>
    statsData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/projects', async (req) =>
    projectsData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/models', async (req) =>
    modelsData(loadAll(projectsDir), req.query.period ?? 'all', pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/session', async (req) =>
    sessionData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/blocks', async (req) =>
    blocksData(loadAll(projectsDir), pickOpts(req.query)),
  )
  app.get<{ Querystring: UsageQuery }>('/api/usage/history', async (req) =>
    historyData(projectsDir, pickOpts(req.query)),
  )
  app.get('/api/usage/live', async () => liveData(projectsDir))
}
