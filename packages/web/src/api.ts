export type SettingsScope = 'user' | 'project' | 'projectLocal' | 'managed'

export interface JsonFileStateDto {
  path: string
  exists: boolean
  raw?: string
  hash?: string
  value?: Record<string, unknown>
  parseError?: string
}

export interface SettingsEntryDto {
  scope: SettingsScope
  editable: boolean
  state: JsonFileStateDto
}

export interface EffectiveDto {
  value: Record<string, unknown>
  sources: Record<string, SettingsScope>
}

export interface SettingsResponse {
  entries: SettingsEntryDto[]
  effective: EffectiveDto
}

export interface EditDto {
  path: string
  value?: unknown
  remove?: boolean
}

export interface PendingChangeDto {
  filePath: string
  before: string
  after: string
  diff: string
  expectedHash: string | null
  nextValue: Record<string, unknown>
}

export interface ApplyResponse {
  applied: boolean
  diff: string
}

export interface BackupEntryDto {
  backupPath: string
  originalPath: string
  timestamp: string
}

export interface HealthDto {
  ok: boolean
  cli: { found: boolean; version?: string }
}

export interface ProjectDto {
  dir: string
  name: string
  exists: boolean
}

const TOKEN_KEY = 'ccs-token'

interface Windowish {
  location: { hash: string; pathname: string; search: string }
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  history: { replaceState(data: unknown, unused: string, url: string): void }
}

/** Fragment → sessionStorage → stripped URL. Returns null when no token is available. */
export function bootstrapToken(win: Windowish): string | null {
  const match = win.location.hash.match(/token=([0-9a-zA-Z]+)/)
  if (match) {
    win.sessionStorage.setItem(TOKEN_KEY, match[1])
    win.history.replaceState(null, '', win.location.pathname + win.location.search)
  }
  return win.sessionStorage.getItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; code?: string },
  ) {
    super(body.error ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

interface ScopeTarget {
  scope: SettingsScope
  projectDir?: string
  edits: EditDto[]
}

export type McpScope = 'user' | 'local' | 'project'

export interface McpServerEntryDto {
  name: string
  scope: McpScope
  config: Record<string, unknown>
}

export interface McpListDto {
  servers: McpServerEntryDto[]
  warnings: string[]
}

export type McpHealthStatus = 'connected' | 'failed' | 'unknown'

export interface McpHealthDto {
  available: boolean
  status: Record<string, McpHealthStatus>
}

export interface PluginDto {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  installedAt?: string
  lastUpdated?: string
  projectPath?: string
}

export interface MarketplaceDto {
  name: string
  source: string
  repo?: string
  installLocation: string
}

export interface PluginsListDto {
  cliFound: boolean
  plugins: PluginDto[]
  marketplaces: MarketplaceDto[]
}

export type FileKind = 'claudeMd' | 'keybindings' | 'agent' | 'skill'
export type FileScope = 'user' | 'project'

export interface NamedFileDto {
  name: string
  path: string
}

export interface ScopeFilesDto {
  claudeMd: { path: string; exists: boolean }
  keybindings?: { path: string; exists: boolean }
  agents: NamedFileDto[]
  skills: NamedFileDto[]
}

export interface FilesListingDto {
  user: ScopeFilesDto
  project?: ScopeFilesDto
}

export interface FileContentDto {
  path: string
  exists: boolean
  content: string
  hash: string | null
}

export class Api {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      throw new ApiError(res.status, body)
    }
    return res.json() as Promise<T>
  }

  health(): Promise<HealthDto> {
    return this.request('/api/health')
  }

  listProjects(extra: string[] = []): Promise<{ projects: ProjectDto[] }> {
    const q = extra.length > 0 ? `?extra=${encodeURIComponent(extra.join(','))}` : ''
    return this.request(`/api/projects${q}`)
  }

  settings(projectDir?: string): Promise<SettingsResponse> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/settings${q}`)
  }

  preview(target: ScopeTarget): Promise<PendingChangeDto> {
    return this.request('/api/settings/preview', { method: 'POST', body: JSON.stringify(target) })
  }

  apply(target: ScopeTarget & { expectedHash: string | null }): Promise<ApplyResponse> {
    return this.request('/api/settings/apply', { method: 'POST', body: JSON.stringify(target) })
  }

  backups(): Promise<{ backups: BackupEntryDto[] }> {
    return this.request('/api/backups')
  }

  restore(backupPath: string): Promise<{ restored: boolean; originalPath: string }> {
    return this.request('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ backupPath }),
    })
  }

  mcp(projectDir?: string): Promise<McpListDto> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/mcp${q}`)
  }

  mcpHealth(projectDir?: string): Promise<McpHealthDto> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/mcp/health${q}`)
  }

  mcpAdd(body: {
    name: string
    scope: McpScope
    config: Record<string, unknown>
    projectDir?: string
  }): Promise<{ via: 'cli' | 'file' }> {
    return this.request('/api/mcp/add', { method: 'POST', body: JSON.stringify(body) })
  }

  mcpRemove(body: { name: string; scope: McpScope; projectDir?: string }): Promise<{ via: string }> {
    return this.request('/api/mcp/remove', { method: 'POST', body: JSON.stringify(body) })
  }

  plugins(): Promise<PluginsListDto> {
    return this.request('/api/plugins')
  }

  pluginAction(action: string, plugin: string): Promise<{ ok: boolean; output: string }> {
    return this.request('/api/plugins/action', {
      method: 'POST',
      body: JSON.stringify({ action, plugin }),
    })
  }

  marketplaceAction(action: string, value: string): Promise<{ ok: boolean; output: string }> {
    return this.request('/api/plugins/marketplace', {
      method: 'POST',
      body: JSON.stringify({ action, value }),
    })
  }

  files(projectDir?: string): Promise<FilesListingDto> {
    const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
    return this.request(`/api/files${q}`)
  }

  fileRead(ref: {
    kind: FileKind
    scope: FileScope
    name?: string
    projectDir?: string
  }): Promise<FileContentDto> {
    const params = new URLSearchParams()
    params.set('kind', ref.kind)
    params.set('scope', ref.scope)
    if (ref.name) params.set('name', ref.name)
    if (ref.projectDir) params.set('projectDir', ref.projectDir)
    return this.request(`/api/files/read?${params.toString()}`)
  }

  fileSave(body: {
    kind: FileKind
    scope: FileScope
    name?: string
    projectDir?: string
    content: string
    expectedHash: string | null
  }): Promise<{ saved: boolean; path: string; hash: string }> {
    return this.request('/api/files/save', { method: 'POST', body: JSON.stringify(body) })
  }
}
