// Typed client for the /api/usage/* endpoints. Deliberately separate from the
// config `Api` so the Usage area stays a self-contained module — it only shares
// the bearer token. DTOs mirror the shapes returned by @claude-code-studio/usage.

export interface Agg {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface TodayDto {
  date: string
  total_cost: number
  turns: number
  models: Record<string, Agg>
}

export interface BlockDto extends Agg {
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

export interface StatsDto extends Agg {
  range: string
  models: string[]
  project_count: number
  session_count: number
}

export interface HeatCellDto {
  date: string
  cost: number
  turns: number
}

export interface OverviewDto {
  today: TodayDto
  active_block: BlockDto | null
  stats: StatsDto
  heatmap: HeatCellDto[]
  generated_at: string
}

export interface DayDto extends Agg {
  date: string
  byModel: Record<string, Agg>
}
export interface DailyDto {
  range: { since: string; until: string }
  days: DayDto[]
}

export interface MonthDto extends Agg {
  month: string
  byModel: Record<string, Agg>
}
export interface MonthlyDto {
  range: { since?: string; until?: string }
  months: MonthDto[]
}

export interface ModelRowDto extends Agg {
  model: string
  share: number
}
export interface ModelsDto {
  period: string
  total_cost: number
  models: ModelRowDto[]
}

export interface ProjectRowDto extends Agg {
  project: string
  display: string
  sessions: number
}

export interface SessionRowDto extends Agg {
  session: string
  project: string
  project_display: string
  turns: number
  first_ts: string
  last_ts: string
  models: string[]
}

export interface PromptRowDto {
  timestamp: string
  project: string
  session?: string
  prompt: string | null
  cost: number | null
}

export interface LiveDto {
  today: TodayDto
  active_block: BlockDto | null
  server_time: string
}

export interface RangeOpts {
  since?: string
  until?: string
  limit?: number
  sort?: string
  period?: string
}

function qs(opts: RangeOpts): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export class UsageApi {
  constructor(private readonly token: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new Error(`${path} → ${res.status}`)
    return res.json() as Promise<T>
  }

  overview = () => this.get<OverviewDto>('/api/usage/overview')
  today = () => this.get<TodayDto>('/api/usage/today')
  daily = (o: RangeOpts = {}) => this.get<DailyDto>('/api/usage/daily' + qs(o))
  monthly = (o: RangeOpts = {}) => this.get<MonthlyDto>('/api/usage/monthly' + qs(o))
  stats = (o: RangeOpts = {}) => this.get<StatsDto>('/api/usage/stats' + qs(o))
  projects = (o: RangeOpts = {}) => this.get<ProjectRowDto[]>('/api/usage/projects' + qs(o))
  models = (o: RangeOpts = {}) => this.get<ModelsDto>('/api/usage/models' + qs(o))
  session = (o: RangeOpts = {}) => this.get<SessionRowDto[]>('/api/usage/session' + qs(o))
  blocks = (o: RangeOpts = {}) => this.get<BlockDto[]>('/api/usage/blocks' + qs(o))
  history = (o: RangeOpts = {}) => this.get<PromptRowDto[]>('/api/usage/history' + qs(o))
  live = () => this.get<LiveDto>('/api/usage/live')
}
