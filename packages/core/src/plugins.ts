import type { CliRunner, CliRunResult } from './cli.js'

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

export type PluginActionName = 'install' | 'uninstall' | 'enable' | 'disable'
export type MarketplaceActionName = 'add' | 'remove'

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
