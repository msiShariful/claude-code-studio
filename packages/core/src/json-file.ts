import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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

export class WriteConflictError extends Error {
  constructor(public readonly filePath: string) {
    super(`File changed on disk since it was read: ${filePath}`)
    this.name = 'WriteConflictError'
  }
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

/**
 * expectedHash semantics:
 *  - undefined: skip the conflict check
 *  - null: caller expects the file not to exist yet
 *  - string: caller expects current content to hash to this value
 */
export async function writeJsonFileAtomic<T>(
  path: string,
  value: T,
  opts: { expectedHash?: string | null } = {},
): Promise<JsonFileState<T>> {
  if (opts.expectedHash !== undefined) {
    const current = await readJsonFile(path)
    const currentHash = current.exists ? current.hash! : null
    if (currentHash !== opts.expectedHash) {
      throw new WriteConflictError(path)
    }
  }
  const raw = serializeJson(value)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, raw, 'utf8')
  await rename(tmp, path)
  return { path, exists: true, raw, hash: hashContent(raw), value }
}
