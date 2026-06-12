import type { SettingsScope } from './api.js'

export interface Leaf {
  path: string
  value: unknown
  source?: SettingsScope
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Walk the effective settings object; scalars and arrays are leaves. */
export function flattenLeaves(
  value: Record<string, unknown>,
  sources: Record<string, SettingsScope>,
  prefix = '',
): Leaf[] {
  const leaves: Leaf[] = []
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(v)) {
      leaves.push(...flattenLeaves(v, sources, path))
    } else {
      leaves.push({ path, value: v, source: sources[path] })
    }
  }
  return leaves
}

export type DiffLineKind = 'meta' | 'add' | 'del' | 'ctx'

export function diffLineKind(line: string): DiffLineKind {
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('@@') ||
    line.startsWith('===') ||
    line.startsWith('Index')
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

/** Edit values are JSON; bare words fall back to plain strings. */
export function parseEditValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
