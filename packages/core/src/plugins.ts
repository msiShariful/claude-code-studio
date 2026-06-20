import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupFile } from './backups.js'
import type { CliRunner, CliRunResult } from './cli.js'
import { readJsonFile, writeJsonFileAtomic, type JsonFileState } from './json-file.js'
import { getProjectPaths } from './paths.js'

export interface PluginInfo {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  installedAt: string
  lastUpdated: string
  projectPath?: string
}

export interface MarketplaceInfo {
  name: string
  source: string
  repo?: string
  installLocation: string
}

/** A plugin offered by an added marketplace (read from its on-disk manifest). */
export interface AvailablePlugin {
  /** what `claude plugin install <id>` takes: `name@marketplace` */
  installId: string
  name: string
  marketplace: string
  description: string
  author?: string
  category?: string
  homepage?: string
}

/** Injectable so tests don't touch the filesystem. */
export type ManifestReader = (path: string) => Promise<string>

const defaultManifestReader: ManifestReader = (path) => readFile(path, 'utf8')

function authorName(author: unknown): string | undefined {
  if (typeof author === 'string') return author
  if (author && typeof author === 'object' && typeof (author as { name?: unknown }).name === 'string') {
    return (author as { name: string }).name
  }
  return undefined
}

/**
 * Enumerate the plugins each added marketplace offers by reading its cloned
 * `<installLocation>/.claude-plugin/marketplace.json`. Marketplaces with a
 * missing or malformed manifest are skipped rather than failing the whole list.
 */
export async function listAvailablePlugins(
  marketplaces: readonly MarketplaceInfo[],
  reader: ManifestReader = defaultManifestReader,
): Promise<AvailablePlugin[]> {
  const out: AvailablePlugin[] = []
  for (const m of marketplaces) {
    if (!m.installLocation) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(await reader(join(m.installLocation, '.claude-plugin', 'marketplace.json')))
    } catch {
      continue
    }
    const plugins = (parsed as { plugins?: unknown })?.plugins
    if (!Array.isArray(plugins)) continue
    for (const p of plugins) {
      if (!p || typeof p !== 'object' || typeof (p as { name?: unknown }).name !== 'string') continue
      const entry = p as { name: string; description?: unknown; author?: unknown; category?: unknown; homepage?: unknown }
      out.push({
        installId: `${entry.name}@${m.name}`,
        name: entry.name,
        marketplace: m.name,
        description: typeof entry.description === 'string' ? entry.description : '',
        ...(authorName(entry.author) ? { author: authorName(entry.author) } : {}),
        ...(typeof entry.category === 'string' ? { category: entry.category } : {}),
        ...(typeof entry.homepage === 'string' ? { homepage: entry.homepage } : {}),
      })
    }
  }
  return out
}

export type PluginActionName = 'install' | 'uninstall' | 'enable' | 'disable'
export type MarketplaceActionName = 'add' | 'remove'
/** Where an enable/disable applies: machine-wide, the project (shared), or local (personal). */
export type PluginScope = 'user' | 'project' | 'local'
/** A project's two enablement files: shared `settings.json` vs personal `settings.local.json`. */
export type ProjectPluginScope = 'project' | 'local'

const PLUGIN_ACTIONS: ReadonlySet<string> = new Set(['install', 'uninstall', 'enable', 'disable'])
const MARKETPLACE_ACTIONS: ReadonlySet<string> = new Set(['add', 'remove'])
const SLOW_ACTIONS: ReadonlySet<string> = new Set(['install', 'add', 'update'])

/** Plugin ids, marketplace names/sources: no leading dash (would parse as a flag). */
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9@:/._~-]*$/

function assertIdentifier(value: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid identifier: ${JSON.stringify(value)}`)
  }
}

async function runJson<T>(runner: CliRunner, args: string[]): Promise<T> {
  const result = await runner('claude', args)
  if (result.exitCode !== 0) {
    throw new Error(`\`claude ${args.join(' ')}\` failed: ${result.stderr || result.stdout}`)
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`\`claude ${args.join(' ')}\` did not return JSON`)
  }
}

export function listPlugins(runner: CliRunner): Promise<PluginInfo[]> {
  return runJson(runner, ['plugin', 'list', '--json'])
}

export function listMarketplaces(runner: CliRunner): Promise<MarketplaceInfo[]> {
  return runJson(runner, ['plugin', 'marketplace', 'list', '--json'])
}

export async function pluginAction(
  runner: CliRunner,
  action: PluginActionName,
  plugin: string,
): Promise<CliRunResult> {
  if (!PLUGIN_ACTIONS.has(action)) throw new Error(`Unknown plugin action: ${String(action)}`)
  assertIdentifier(plugin)
  return runner('claude', ['plugin', action, plugin], {
    timeoutMs: SLOW_ACTIONS.has(action) ? 120_000 : 30_000,
  })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Does this settings file already carry an enabledPlugins entry for the plugin? */
function hasEnabledEntry(state: JsonFileState<Record<string, unknown>>, id: string): boolean {
  const enabled = state.value?.enabledPlugins
  return isObject(enabled) && id in enabled
}

/** A project's two enablement files, each as its own override map. */
export interface ProjectEnabledByFile {
  /** shared `.claude/settings.json` — committed, applies to the whole team */
  project: Record<string, boolean>
  /** personal `.claude/settings.local.json` — gitignored, applies to you only */
  local: Record<string, boolean>
}

/** The boolean `enabledPlugins` entries recorded in a single settings file. */
async function readEnabledMap(file: string): Promise<Record<string, boolean>> {
  const state = await readJsonFile<Record<string, unknown>>(file)
  const enabled = state.value?.enabledPlugins
  const out: Record<string, boolean> = {}
  if (isObject(enabled)) {
    for (const [id, on] of Object.entries(enabled)) {
      if (typeof on === 'boolean') out[id] = on
    }
  }
  return out
}

/**
 * A project's per-plugin overrides kept *separated by file*, so the UI can show what
 * the shared `settings.json` records apart from the personal `settings.local.json` —
 * the same split the settings editor draws. `claude plugin list` only reports these
 * for projects already registered in `~/.claude.json`, so we read the files directly.
 */
export async function readProjectEnabledPluginsByFile(
  projectDir: string,
): Promise<ProjectEnabledByFile> {
  const paths = getProjectPaths(projectDir)
  return {
    project: await readEnabledMap(paths.settings),
    local: await readEnabledMap(paths.settingsLocal),
  }
}

/**
 * A project's per-plugin on/off overrides, merged across its settings files — local
 * settings win over shared project settings (the effective enablement state).
 */
export async function readProjectEnabledPlugins(
  projectDir: string,
): Promise<Record<string, boolean>> {
  const { project, local } = await readProjectEnabledPluginsByFile(projectDir)
  return { ...project, ...local }
}

/**
 * Enable or disable a plugin for a single project by writing its `enabledPlugins`
 * flag straight into the project's settings file — the same thing `claude plugin
 * enable/disable` does, but done directly so we can target the team-shared
 * `settings.json` or the personal `settings.local.json` deterministically, and so we
 * can override a machine-wide (user-scope) plugin per project (the CLI refuses to,
 * since the plugin isn't "installed" at project/local scope). When the plugin already
 * has an entry in one of the files, that file is updated in place — avoiding a
 * conflicting entry in the higher-precedence file; otherwise the requested scope is
 * used. Writes atomically, backing up the file first.
 */
export async function setProjectPluginEnabled(
  edit: { projectDir: string; pluginId: string; enabled: boolean; scope: ProjectPluginScope },
  opts: { backupsRoot: string },
): Promise<{ scope: ProjectPluginScope; file: string }> {
  assertIdentifier(edit.pluginId)
  if (edit.scope !== 'project' && edit.scope !== 'local') {
    throw new Error(`Unknown project plugin scope: ${String(edit.scope)}`)
  }
  const paths = getProjectPaths(edit.projectDir)
  const localState = await readJsonFile<Record<string, unknown>>(paths.settingsLocal)
  const projectState = await readJsonFile<Record<string, unknown>>(paths.settings)
  const scope: ProjectPluginScope = hasEnabledEntry(localState, edit.pluginId)
    ? 'local'
    : hasEnabledEntry(projectState, edit.pluginId)
      ? 'project'
      : edit.scope
  const file = scope === 'local' ? paths.settingsLocal : paths.settings
  const state = scope === 'local' ? localState : projectState
  if (state.parseError) {
    throw new Error(`Refusing to edit ${file}: not valid JSON (${state.parseError})`)
  }
  const root = structuredClone(state.value ?? {})
  if (!isObject(root.enabledPlugins)) root.enabledPlugins = {}
  ;(root.enabledPlugins as Record<string, unknown>)[edit.pluginId] = edit.enabled
  await backupFile(file, opts.backupsRoot)
  await writeJsonFileAtomic(file, root, { expectedHash: state.exists ? state.hash! : null })
  return { scope, file }
}

export async function marketplaceAction(
  runner: CliRunner,
  action: MarketplaceActionName,
  value: string,
): Promise<CliRunResult> {
  if (!MARKETPLACE_ACTIONS.has(action)) {
    throw new Error(`Unknown marketplace action: ${String(action)}`)
  }
  assertIdentifier(value)
  return runner('claude', ['plugin', 'marketplace', action, value], {
    timeoutMs: SLOW_ACTIONS.has(action) ? 120_000 : 30_000,
  })
}
