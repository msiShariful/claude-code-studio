import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WriteConflictError, readJsonFile, writeJsonFileAtomic } from '../src/json-file.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ccs-json-'))
}

describe('readJsonFile', () => {
  it('reports a missing file without throwing', async () => {
    const dir = await tempDir()
    const state = await readJsonFile(join(dir, 'nope.json'))
    expect(state.exists).toBe(false)
    expect(state.value).toBeUndefined()
  })

  it('parses valid JSON and computes a content hash', async () => {
    const dir = await tempDir()
    const file = join(dir, 'ok.json')
    await writeFile(file, '{"a": 1}')
    const state = await readJsonFile<{ a: number }>(file)
    expect(state.exists).toBe(true)
    expect(state.value?.a).toBe(1)
    expect(state.raw).toBe('{"a": 1}')
    expect(state.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.parseError).toBeUndefined()
  })

  it('surfaces parse errors but preserves the raw content', async () => {
    const dir = await tempDir()
    const file = join(dir, 'bad.json')
    await writeFile(file, '{oops')
    const state = await readJsonFile(file)
    expect(state.exists).toBe(true)
    expect(state.parseError).toBeTruthy()
    expect(state.value).toBeUndefined()
    expect(state.raw).toBe('{oops')
  })
})

describe('writeJsonFileAtomic', () => {
  it('writes pretty JSON, creating parent directories', async () => {
    const dir = await tempDir()
    const file = join(dir, 'deep', 'nested', 'new.json')
    const state = await writeJsonFileAtomic(file, { b: 2 })
    expect(state.raw).toBe('{\n  "b": 2\n}\n')
    expect(await readFile(file, 'utf8')).toBe('{\n  "b": 2\n}\n')
  })

  it('throws WriteConflictError when the file changed since it was read', async () => {
    const dir = await tempDir()
    const file = join(dir, 'c.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    await writeFile(file, '{"v": 999}') // external change
    await expect(
      writeJsonFileAtomic(file, { v: 2 }, { expectedHash: before.hash }),
    ).rejects.toBeInstanceOf(WriteConflictError)
  })

  it('throws WriteConflictError when expecting no file but one exists', async () => {
    const dir = await tempDir()
    const file = join(dir, 'd.json')
    await writeFile(file, '{}')
    await expect(
      writeJsonFileAtomic(file, { v: 1 }, { expectedHash: null }),
    ).rejects.toBeInstanceOf(WriteConflictError)
  })

  it('writes when the expected hash matches', async () => {
    const dir = await tempDir()
    const file = join(dir, 'e.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    const after = await writeJsonFileAtomic(file, { v: 2 }, { expectedHash: before.hash })
    expect(after.value).toEqual({ v: 2 })
  })

  it('exposes a stable code on WriteConflictError for HTTP mapping', async () => {
    const dir = await tempDir()
    const file = join(dir, 'conflict-code.json')
    await writeFile(file, '{"v": 1}')
    const before = await readJsonFile(file)
    await writeFile(file, '{"v": 2}')
    const err = await writeJsonFileAtomic(file, { v: 3 }, { expectedHash: before.hash }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(WriteConflictError)
    expect((err as WriteConflictError).code).toBe('WRITE_CONFLICT')
  })
})
