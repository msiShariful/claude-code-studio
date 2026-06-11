import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export interface JsonFileState<T = unknown> {
  path: string
  exists: boolean
  raw?: string
  /** sha256 hex of raw content; used for write-conflict detection */
  hash?: string
  value?: T
  parseError?: string
}

export function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function readJsonFile<T = unknown>(path: string): Promise<JsonFileState<T>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, exists: false }
    }
    throw err
  }
  const state: JsonFileState<T> = { path, exists: true, raw, hash: hashContent(raw) }
  try {
    state.value = JSON.parse(raw) as T
  } catch (err) {
    state.parseError = (err as Error).message
  }
  return state
}
