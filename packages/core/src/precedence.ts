import { SCOPE_ORDER, type SettingsFileEntry, type SettingsScope } from './settings.js'

export interface EffectiveSettings {
  value: Record<string, unknown>
  /** dotted leaf path (e.g. "env.FOO") -> scope that supplied the winning value */
  sources: Record<string, SettingsScope>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function resolveEffectiveSettings(entries: SettingsFileEntry[]): EffectiveSettings {
  const value: Record<string, unknown> = {}
  const sources: Record<string, SettingsScope> = {}
  for (const scope of SCOPE_ORDER) {
    const entry = entries.find((e) => e.scope === scope)
    if (!entry?.state.value) continue
    mergeInto(value, entry.state.value, scope, sources, '')
  }
  return { value, sources }
}

function mergeInto(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  scope: SettingsScope,
  sources: Record<string, SettingsScope>,
  prefix: string,
): void {
  for (const [key, v] of Object.entries(src)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(v)) {
      if (!isPlainObject(target[key])) target[key] = {}
      mergeInto(target[key] as Record<string, unknown>, v, scope, sources, path)
    } else {
      target[key] = v
      sources[path] = scope
    }
  }
}
