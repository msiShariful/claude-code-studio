import { createTwoFilesPatch } from 'diff'
import { backupFile } from './backups.js'
import {
  readJsonFile,
  serializeJson,
  WriteConflictError,
  writeJsonFileAtomic,
  type JsonFileState,
} from './json-file.js'

export interface SettingsEdit {
  /** Dotted path into the JSON document, e.g. "permissions.defaultMode" */
  path: string
  /** New value; ignored when remove is true */
  value?: unknown
  remove?: boolean
}

export interface PendingChange {
  filePath: string
  before: string
  after: string
  /** Unified diff for the user-facing preview */
  diff: string
  /** Hash the file must still have at apply time (null = file must not exist). */
  expectedHash: string | null
  nextValue: Record<string, unknown>
}

export function planJsonUpdate(
  state: JsonFileState<Record<string, unknown>>,
  edits: SettingsEdit[],
): PendingChange {
  if (state.parseError) {
    throw new Error(
      `Refusing to edit ${state.path}: existing content is not valid JSON (${state.parseError})`,
    )
  }
  const next = structuredClone(state.value ?? {})
  for (const edit of edits) applyEdit(next, edit)
  const before = state.raw ?? ''
  const after = serializeJson(next)
  return {
    filePath: state.path,
    before,
    after,
    diff: createTwoFilesPatch(state.path, state.path, before, after),
    expectedHash: state.exists ? state.hash! : null,
    nextValue: next,
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function applyEdit(root: Record<string, unknown>, edit: SettingsEdit): void {
  if (!edit.path) throw new Error('SettingsEdit.path must not be empty')
  const keys = edit.path.split('.')
  if (keys.some((key) => FORBIDDEN_KEYS.has(key))) {
    throw new Error(`Refusing to edit forbidden key in path: ${edit.path}`)
  }
  const last = keys.pop()!
  let node = root
  for (const key of keys) {
    const child = node[key]
    if (Array.isArray(child)) {
      if (edit.remove) return // nothing to remove inside an array via a dotted path
      throw new Error(`Cannot set "${edit.path}": "${key}" is an array, not an object`)
    }
    if (typeof child !== 'object' || child === null) {
      if (edit.remove) return // nothing to remove along a missing path
      node[key] = {}
    }
    node = node[key] as Record<string, unknown>
  }
  if (edit.remove) delete node[last]
  else node[last] = edit.value
}

/** Re-checks the hash, backs up the current file, then writes atomically. Note: the backup is taken before the final write-time conflict check, so a rejected write can leave an extra (harmless, prunable) backup. */
export async function applyChange(
  change: PendingChange,
  backupsRoot: string,
): Promise<JsonFileState<Record<string, unknown>>> {
  const current = await readJsonFile(change.filePath)
  const currentHash = current.exists ? current.hash! : null
  if (currentHash !== change.expectedHash) {
    throw new WriteConflictError(change.filePath)
  }
  await backupFile(change.filePath, backupsRoot)
  return writeJsonFileAtomic(change.filePath, change.nextValue, {
    expectedHash: change.expectedHash,
  })
}
