// Pure aggregation over usage records — the single source of truth for *what*
// gets measured. Every function returns plain JSON, ready to encode to the
// browser. Ported from the source CLI's web/data.js, typed, with an overview
// combiner + spend heatmap added for the new dashboard.

import { basename } from 'node:path'
import { calcCost, type RawUsage } from './pricing.js'
import { filterByPeriod, periodLabel, type Range } from './filters.js'
import { loadAllMessages, loadAll, type UsageRecord } from './parser.js'
import { extractPromptText } from './text.js'

const BLOCK_MS = 5 * 60 * 60 * 1000

export interface Agg {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

function emptyAgg(): Agg {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}
function addUsage(agg: Agg, r: { usage: RawUsage; model: string }): void {
  agg.input += r.usage.input_tokens ?? 0
  agg.output += r.usage.output_tokens ?? 0
  agg.cacheRead += r.usage.cache_read_input_tokens ?? 0
  agg.cacheWrite += r.usage.cache_creation_input_tokens ?? 0
  agg.cost += calcCost(r.usage, r.model)
}
/** Drop the `-YYYYMMDD` date suffix so "claude-sonnet-4-6-20260514" → family key. */
const modelKey = (m: string): string => (m || 'unknown').replace(/-\d{8}$/, '')

export interface TodayData {
  date: string
  total_cost: number
  turns: number
  models: Record<string, Agg>
}
export function todayData(records: UsageRecord[]): TodayData {
  const today = new Date().toISOString().slice(0, 10)
  const recs = records.filter((r) => r.ts.startsWith(today))
  const models: Record<string, Agg> = {}
  for (const r of recs) {
    const m = modelKey(r.model)
    models[m] ??= emptyAgg()
    addUsage(models[m], r)
  }
  const total = Object.values(models).reduce((s, v) => s + v.cost, 0)
  return { date: today, total_cost: total, turns: recs.length, models }
}

function enumerateDays(lo: string, hi: string): string[] {
  const out: string[] = []
  const end = new Date(hi + 'T00:00:00Z')
  for (let d = new Date(lo + 'T00:00:00Z'); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export interface DayAgg extends Agg {
  date: string
  byModel: Record<string, Agg>
}
export interface DailyData {
  range: { since: string; until: string }
  days: DayAgg[]
}
export function dailyData(records: UsageRecord[], { since, until }: Range = {}): DailyData {
  let lo: string, hi: string
  if (since || until) {
    records = filterByPeriod(records, 'all', { since, until })
    const min = records.reduce<string | null>((m, r) => {
      const d = r.ts.slice(0, 10)
      return !m || d < m ? d : m
    }, null)
    lo = since ?? min ?? new Date().toISOString().slice(0, 10)
    hi = until ?? new Date().toISOString().slice(0, 10)
  } else {
    const now = Date.now()
    hi = new Date(now).toISOString().slice(0, 10)
    lo = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10)
    records = records.filter((r) => r.ts.slice(0, 10) >= lo)
  }
  const byDay: Record<string, DayAgg> = {}
  for (const r of records) {
    const day = r.ts.slice(0, 10)
    if (!day || day < lo || day > hi) continue
    byDay[day] ??= { ...emptyAgg(), date: day, byModel: {} }
    addUsage(byDay[day], r)
    const m = modelKey(r.model)
    byDay[day].byModel[m] ??= emptyAgg()
    addUsage(byDay[day].byModel[m], r)
  }
  return {
    range: { since: lo, until: hi },
    days: enumerateDays(lo, hi).map((d) => byDay[d] ?? { ...emptyAgg(), date: d, byModel: {} }),
  }
}

export interface MonthAgg extends Agg {
  month: string
  byModel: Record<string, Agg>
}
export function monthlyData(records: UsageRecord[], { since, until }: Range = {}) {
  records = filterByPeriod(records, 'all', { since, until })
  const byMonth: Record<string, MonthAgg> = {}
  for (const r of records) {
    const month = r.ts.slice(0, 7)
    if (!month) continue
    byMonth[month] ??= { ...emptyAgg(), month, byModel: {} }
    addUsage(byMonth[month], r)
    const m = modelKey(r.model)
    byMonth[month].byModel[m] ??= emptyAgg()
    addUsage(byMonth[month].byModel[m], r)
  }
  return { range: { since, until }, months: Object.keys(byMonth).sort().map((m) => byMonth[m]) }
}

export interface StatsData extends Agg {
  range: string
  models: string[]
  project_count: number
  session_count: number
}
export function statsData(records: UsageRecord[], { since, until }: Range = {}): StatsData {
  records = filterByPeriod(records, 'all', { since, until })
  const agg = emptyAgg()
  const models = new Set<string>(),
    projects = new Set<string>(),
    sessions = new Set<string>()
  for (const r of records) {
    addUsage(agg, r)
    if (r.model) models.add(modelKey(r.model))
    if (r.project) projects.add(r.project)
    if (r.session) sessions.add(r.session)
  }
  return {
    range: periodLabel('all', { since, until }),
    ...agg,
    models: [...models].sort(),
    project_count: projects.size,
    session_count: sessions.size,
  }
}

export interface ProjectRow extends Agg {
  project: string
  display: string
  sessions: number
}
export function projectsData(records: UsageRecord[], { since, until }: Range = {}): ProjectRow[] {
  records = filterByPeriod(records, 'all', { since, until })
  const byProject: Record<string, Agg & { sessions: Set<string> }> = {}
  for (const r of records) {
    const key = r.project ?? 'unknown'
    byProject[key] ??= { ...emptyAgg(), sessions: new Set() }
    addUsage(byProject[key], r)
    if (r.session) byProject[key].sessions.add(r.session)
  }
  return Object.entries(byProject)
    .map(([name, v]) => ({
      project: name,
      display: name.split('-').filter(Boolean).slice(-2).join('/'),
      sessions: v.sessions.size,
      input: v.input,
      output: v.output,
      cacheRead: v.cacheRead,
      cacheWrite: v.cacheWrite,
      cost: v.cost,
    }))
    .sort((a, b) => b.cost - a.cost)
}

export interface ModelRow extends Agg {
  model: string
  share: number
}
export function modelsData(records: UsageRecord[], period = 'all', { since, until }: Range = {}) {
  const filtered = filterByPeriod(records, period, { since, until })
  const byModel: Record<string, Agg> = {}
  for (const r of filtered) {
    const m = modelKey(r.model)
    byModel[m] ??= emptyAgg()
    addUsage(byModel[m], r)
  }
  const sorted = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost)
  const totalCost = sorted.reduce((s, [, v]) => s + v.cost, 0)
  return {
    period: periodLabel(period, { since, until }),
    total_cost: totalCost,
    models: sorted.map(([m, v]) => ({ model: m, ...v, share: totalCost ? v.cost / totalCost : 0 })),
  }
}

export interface SessionRow extends Agg {
  session: string
  project: string
  project_display: string
  turns: number
  first_ts: string
  last_ts: string
  models: string[]
}
export function sessionData(
  records: UsageRecord[],
  { since, until, limit = 50, sort = 'cost' }: Range & { limit?: number; sort?: string } = {},
): SessionRow[] {
  const filtered = filterByPeriod(records, 'all', { since, until })
  const bySession: Record<
    string,
    Agg & { project: string; firstTs: string; lastTs: string; turns: number; models: Set<string> }
  > = {}
  for (const r of filtered) {
    const id = r.session ?? 'unknown'
    bySession[id] ??= {
      ...emptyAgg(),
      project: r.project ?? '',
      firstTs: r.ts,
      lastTs: r.ts,
      turns: 0,
      models: new Set(),
    }
    const s = bySession[id]
    addUsage(s, r)
    s.turns += 1
    if (r.model) s.models.add(modelKey(r.model))
    if (r.ts < s.firstTs) s.firstTs = r.ts
    if (r.ts > s.lastTs) s.lastTs = r.ts
  }
  return Object.entries(bySession)
    .sort((a, b) =>
      sort === 'recent' ? b[1].lastTs.localeCompare(a[1].lastTs) : b[1].cost - a[1].cost,
    )
    .slice(0, limit)
    .map(([id, v]) => ({
      session: id,
      project: v.project,
      project_display: v.project.split('-').filter(Boolean).slice(-1)[0] ?? '—',
      turns: v.turns,
      first_ts: v.firstTs,
      last_ts: v.lastTs,
      models: [...v.models],
      input: v.input,
      output: v.output,
      cacheRead: v.cacheRead,
      cacheWrite: v.cacheWrite,
      cost: v.cost,
    }))
}

export interface BlockData extends Agg {
  start: string
  end: string
  active: boolean
  turns: number
  models: string[]
  burn_rate_per_hour: number
  projected_cost: number
  remaining_ms: number
  elapsed_ms: number
  progress_pct: number
}
export function blocksData(records: UsageRecord[], { limit = 20 }: { limit?: number } = {}): BlockData[] {
  const sorted = records
    .filter((r) => r.ts)
    .map((r) => ({ ...r, t: Date.parse(r.ts) }))
    .filter((r) => !Number.isNaN(r.t))
    .sort((a, b) => a.t - b.t)

  type Cur = Agg & { startMs: number; endMs: number; turns: number; models: Set<string> }
  const blocks: Cur[] = []
  let cur: Cur | null = null
  for (const r of sorted) {
    if (!cur || r.t >= cur.startMs + BLOCK_MS) {
      cur = { startMs: r.t, endMs: r.t + BLOCK_MS, ...emptyAgg(), turns: 0, models: new Set() }
      blocks.push(cur)
    }
    addUsage(cur, r)
    cur.turns += 1
    if (r.model) cur.models.add(modelKey(r.model))
  }
  const now = Date.now()
  return blocks
    .slice(-limit)
    .reverse()
    .map((b) => {
      const active = now < b.endMs
      const elapsed = Math.min(now, b.endMs) - b.startMs
      const remaining = active ? b.endMs - now : 0
      const burn = elapsed > 0 ? b.cost / (elapsed / 3_600_000) : 0
      return {
        start: new Date(b.startMs).toISOString(),
        end: new Date(b.endMs).toISOString(),
        active,
        turns: b.turns,
        models: [...b.models],
        input: b.input,
        output: b.output,
        cacheRead: b.cacheRead,
        cacheWrite: b.cacheWrite,
        cost: b.cost,
        burn_rate_per_hour: burn,
        projected_cost: active ? b.cost + burn * (remaining / 3_600_000) : b.cost,
        remaining_ms: remaining,
        elapsed_ms: elapsed,
        progress_pct: Math.min(100, (elapsed / BLOCK_MS) * 100),
      }
    })
}

export interface PromptRow {
  timestamp: string
  project: string
  session?: string
  prompt: string | null
  cost: number | null
}
export function historyData(
  projectsDir: string,
  { project, since, until, limit = 100 }: Range & { project?: string; limit?: number } = {},
): PromptRow[] {
  const all = loadAllMessages(projectsDir)
  const costByParent = new Map<string, number>()
  for (const m of all) {
    if (m.type === 'assistant' && m.parentUuid) {
      costByParent.set(m.parentUuid, (costByParent.get(m.parentUuid) ?? 0) + calcCost(m.usage, m.model))
    }
  }
  let prompts = all.filter(
    (m): m is Extract<typeof m, { type: 'user' }> =>
      m.type === 'user' && !!m.content && extractPromptText(m.content, 1) !== null,
  )
  if (project) prompts = prompts.filter((m) => (m.cwd ? basename(m.cwd) : '') === project)
  if (since) prompts = prompts.filter((m) => m.timestamp.slice(0, 10) >= since)
  if (until) prompts = prompts.filter((m) => m.timestamp.slice(0, 10) <= until)
  prompts.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return prompts.slice(0, limit).map((p) => ({
    timestamp: p.timestamp,
    project: p.cwd ? basename(p.cwd) : 'unknown',
    session: p.session,
    prompt: extractPromptText(p.content, 200),
    cost: p.uuid ? (costByParent.get(p.uuid) ?? null) : null,
  }))
}

export interface HeatCell {
  date: string
  cost: number
  turns: number
}
/** Per-day spend for the last `days` days (zero-filled) — drives the calendar. */
export function heatmapData(records: UsageRecord[], days = 84): HeatCell[] {
  const now = Date.now()
  const hi = new Date(now).toISOString().slice(0, 10)
  const lo = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const byDay: Record<string, HeatCell> = {}
  for (const r of records) {
    const d = r.ts.slice(0, 10)
    if (!d || d < lo || d > hi) continue
    byDay[d] ??= { date: d, cost: 0, turns: 0 }
    byDay[d].cost += calcCost(r.usage, r.model)
    byDay[d].turns += 1
  }
  return enumerateDays(lo, hi).map((d) => byDay[d] ?? { date: d, cost: 0, turns: 0 })
}

export interface LiveData {
  today: TodayData
  active_block: BlockData | null
  server_time: string
}
export function liveData(projectsDir: string): LiveData {
  const records = loadAll(projectsDir)
  return {
    today: todayData(records),
    active_block: blocksData(records, { limit: 1 }).filter((b) => b.active)[0] ?? null,
    server_time: new Date().toISOString(),
  }
}

export interface OverviewData {
  today: TodayData
  active_block: BlockData | null
  stats: StatsData
  heatmap: HeatCell[]
  generated_at: string
}
/** Everything the Overview screen needs, in one read. */
export function overviewData(records: UsageRecord[]): OverviewData {
  return {
    today: todayData(records),
    active_block: blocksData(records, { limit: 1 }).filter((b) => b.active)[0] ?? null,
    stats: statsData(records),
    heatmap: heatmapData(records),
    generated_at: new Date().toISOString(),
  }
}
