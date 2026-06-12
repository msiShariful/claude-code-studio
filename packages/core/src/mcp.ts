import { join } from 'node:path'
import { readJsonFile } from './json-file.js'
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
