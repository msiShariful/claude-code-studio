import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashContent, WriteConflictError } from './json-file.js'

export interface TextFileState {
  path: string
  exists: boolean
  content?: string
  /** sha256 hex of content; used for write-conflict detection */
  hash?: string
}

export async function readTextFile(path: string): Promise<TextFileState> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, exists: false }
    }
    throw err
  }
  return { path, exists: true, content, hash: hashContent(content) }
}

/** Same expectedHash semantics as writeJsonFileAtomic (undefined skip / null must-not-exist / string must match). */
export async function writeTextFileAtomic(
  path: string,
  content: string,
  opts: { expectedHash?: string | null } = {},
): Promise<TextFileState> {
  if (opts.expectedHash !== undefined) {
    const current = await readTextFile(path)
    const currentHash = current.exists ? current.hash! : null
    if (currentHash !== opts.expectedHash) {
      throw new WriteConflictError(path)
    }
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
  return { path, exists: true, content, hash: hashContent(content) }
}
