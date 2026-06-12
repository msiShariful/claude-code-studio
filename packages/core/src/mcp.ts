import { join } from 'node:path'
import { backupFile } from './backups.js'
import type { CliRunner, CliRunResult } from './cli.js'
import { readJsonFile, writeJsonFileAtomic } from './json-file.js'
import type { GlobalPaths } from './paths.js'

export type McpScope = 'user' | 'local' | 'project'

export const MCP_SCOPES: readonly McpScope[] = ['user', 'local', 'project']

/** Loose by design: the CLI owns this format; we pass it through untouched. */
export type McpServerConfig = Record<string, unknown>

export interface McpServerEntry {
  name: string
  scope: McpScope
  config: McpServerConfig
}

export interface McpReadResult {
  servers: McpServerEntry[]
  /** Human-readable problems (e.g. parse errors) — shown, never thrown. */
  warnings: string[]
}

const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function collect(
  raw: unknown,
  scope: McpScope,
  servers: McpServerEntry[],
): void {
  if (!isPlainObject(raw)) return
  for (const [name, config] of Object.entries(raw)) {
    if (FORBIDDEN_NAMES.has(name) || !isPlainObject(config)) continue
    servers.push({ name, scope, config })
  }
}

export function projectMcpJsonPath(projectDir: string): string {
  return join(projectDir, '.mcp.json')
}

export async function readMcpServers(
  global: GlobalPaths,
  projectDir?: string,
): Promise<McpReadResult> {
  const servers: McpServerEntry[] = []
  const warnings: string[] = []

  const claudeJson = await readJsonFile<Record<string, unknown>>(global.claudeJson)
  if (claudeJson.parseError) {
    warnings.push(`${global.claudeJson}: ${claudeJson.parseError}`)
  } else if (claudeJson.value) {
    collect(claudeJson.value.mcpServers, 'user', servers)
    if (projectDir) {
      const projects = claudeJson.value.projects
      if (isPlainObject(projects) && isPlainObject(projects[projectDir])) {
        collect((projects[projectDir] as Record<string, unknown>).mcpServers, 'local', servers)
      }
    }
  }

  if (projectDir) {
    const mcpJson = await readJsonFile<Record<string, unknown>>(projectMcpJsonPath(projectDir))
    if (mcpJson.parseError) {
      warnings.push(`${mcpJson.path}: ${mcpJson.parseError}`)
    } else if (mcpJson.value) {
      collect(mcpJson.value.mcpServers, 'project', servers)
    }
  }

  return { servers, warnings }
}

/** No leading dash (execFile args starting with - are parsed as flags). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface McpWriteOptions {
  global: GlobalPaths
  projectDir?: string
  backupsRoot: string
  runner: CliRunner
}

export interface McpWriteResult {
  via: 'cli' | 'file'
  result?: CliRunResult
}

function validateTarget(name: string, scope: McpScope, projectDir?: string): void {
  if (!NAME_RE.test(name) || FORBIDDEN_NAMES.has(name)) {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(name)}`)
  }
  if (scope !== 'user' && !projectDir) {
    throw new Error(`projectDir is required for the ${scope} scope`)
  }
}

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export async function addMcpServer(
  target: { name: string; scope: McpScope; config: McpServerConfig },
  opts: McpWriteOptions,
): Promise<McpWriteResult> {
  validateTarget(target.name, target.scope, opts.projectDir)
  try {
    const result = await opts.runner(
      'claude',
      ['mcp', 'add-json', target.name, JSON.stringify(target.config), '-s', target.scope],
      { cwd: opts.projectDir },
    )
    return { via: 'cli', result }
  } catch (err) {
    if (!isMissingBinary(err)) throw err
  }
  await mutateMcpFile(target.scope, opts, target.name, target.config)
  return { via: 'file' }
}

export async function removeMcpServer(
  target: { name: string; scope: McpScope },
  opts: McpWriteOptions,
): Promise<McpWriteResult> {
  validateTarget(target.name, target.scope, opts.projectDir)
  try {
    const result = await opts.runner('claude', ['mcp', 'remove', target.name, '-s', target.scope], {
      cwd: opts.projectDir,
    })
    return { via: 'cli', result }
  } catch (err) {
    if (!isMissingBinary(err)) throw err
  }
  await mutateMcpFile(target.scope, opts, target.name, null)
  return { via: 'file' }
}

/** Fallback path: navigate real keys (never dotted paths — names may contain dots). */
async function mutateMcpFile(
  scope: McpScope,
  opts: McpWriteOptions,
  name: string,
  config: McpServerConfig | null,
): Promise<void> {
  const filePath = scope === 'project' ? projectMcpJsonPath(opts.projectDir!) : opts.global.claudeJson
  const state = await readJsonFile<Record<string, unknown>>(filePath)
  if (state.parseError) {
    throw new Error(`Refusing to edit ${filePath}: not valid JSON (${state.parseError})`)
  }
  const root = structuredClone(state.value ?? {})
  let holder: Record<string, unknown> = root
  if (scope === 'local') {
    if (!isPlainObject(holder.projects)) holder.projects = {}
    const projects = holder.projects as Record<string, unknown>
    if (!isPlainObject(projects[opts.projectDir!])) projects[opts.projectDir!] = {}
    holder = projects[opts.projectDir!] as Record<string, unknown>
  }
  if (!isPlainObject(holder.mcpServers)) holder.mcpServers = {}
  const servers = holder.mcpServers as Record<string, unknown>
  if (config === null) delete servers[name]
  else servers[name] = config
  await backupFile(filePath, opts.backupsRoot)
  await writeJsonFileAtomic(filePath, root, {
    expectedHash: state.exists ? state.hash! : null,
  })
}
