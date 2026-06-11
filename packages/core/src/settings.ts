import { readJsonFile, type JsonFileState } from './json-file.js'
import type { GlobalPaths, ProjectPaths } from './paths.js'

export type SettingsScope = 'user' | 'project' | 'projectLocal' | 'managed'

/** Lowest to highest precedence. */
export const SCOPE_ORDER: SettingsScope[] = ['user', 'project', 'projectLocal', 'managed']

export interface SettingsFileEntry {
  scope: SettingsScope
  /** Managed (enterprise) settings are shown read-only. */
  editable: boolean
  state: JsonFileState<Record<string, unknown>>
}

export async function readSettingsFiles(
  global: GlobalPaths,
  project?: ProjectPaths,
): Promise<SettingsFileEntry[]> {
  const entries: SettingsFileEntry[] = [
    { scope: 'user', editable: true, state: await readJsonFile(global.settings) },
  ]
  if (project) {
    entries.push(
      { scope: 'project', editable: true, state: await readJsonFile(project.settings) },
      { scope: 'projectLocal', editable: true, state: await readJsonFile(project.settingsLocal) },
    )
  }
  entries.push({
    scope: 'managed',
    editable: false,
    state: await readJsonFile(global.managedSettings),
  })
  return entries
}
