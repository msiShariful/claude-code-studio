import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonFile } from '../src/json-file.js'

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
