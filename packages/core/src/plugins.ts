import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliRunner, CliRunResult } from './cli.js'
import { readJsonFile } from './json-file.js'
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
/** Where an enable/disable/install applies: machine-wide, the project (shared), or local (personal). */
export type PluginScope = 'user' | 'project' | 'local'

const PLUGIN_ACTIONS: ReadonlySet<string> = new Set(['install', 'uninstall', 'enable', 'disable'])
const MARKETPLACE_ACTIONS: ReadonlySet<string> = new Set(['add', 'remove'])
const PLUGIN_SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'local'])
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
  opts: { scope?: PluginScope; cwd?: string } = {},
): Promise<CliRunResult> {
  if (!PLUGIN_ACTIONS.has(action)) throw new Error(`Unknown plugin action: ${String(action)}`)
  assertIdentifier(plugin)
  const args = ['plugin', action, plugin]
  if (opts.scope !== undefined) {
    if (!PLUGIN_SCOPES.has(opts.scope)) throw new Error(`Unknown plugin scope: ${String(opts.scope)}`)
    // project/local scope resolve relative to cwd, so the runner must run there.
    args.push('--scope', opts.scope)
  }
  return runner('claude', args, {
    cwd: opts.cwd,
    timeoutMs: SLOW_ACTIONS.has(action) ? 120_000 : 30_000,
  })
}

/**
 * A project's per-plugin on/off overrides, read straight from its settings files
 * (`enabledPlugins` map) — local settings win over shared project settings. This is
 * the reliable source for project enablement; `claude plugin list` only reports it
 * for projects already registered in `~/.claude.json`.
 */
export async function readProjectEnabledPlugins(
  projectDir: string,
): Promise<Record<string, boolean>> {
  const paths = getProjectPaths(projectDir)
  const out: Record<string, boolean> = {}
  // project first, then local — later writes override earlier ones.
  for (const file of [paths.settings, paths.settingsLocal]) {
    const state = await readJsonFile<Record<string, unknown>>(file)
    const enabled = state.value?.enabledPlugins
    if (!enabled || typeof enabled !== 'object' || Array.isArray(enabled)) continue
    for (const [id, on] of Object.entries(enabled)) {
      if (typeof on === 'boolean') out[id] = on
    }
  }
  return out
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
