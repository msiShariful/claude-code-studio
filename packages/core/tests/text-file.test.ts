import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WriteConflictError } from '../src/json-file.js'
import { readTextFile, writeTextFileAtomic } from '../src/text-file.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ccs-text-'))
}

describe('readTextFile', () => {
  it('reports a missing file without throwing', async () => {
    const dir = await tempDir()
    const state = await readTextFile(join(dir, 'nope.md'))
    expect(state.exists).toBe(false)
    expect(state.content).toBeUndefined()
  })

  it('reads content and computes a hash', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.md')
    await writeFile(file, '# Hello\n')
    const state = await readTextFile(file)
    expect(state.exists).toBe(true)
    expect(state.content).toBe('# Hello\n')
    expect(state.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('writeTextFileAtomic', () => {
  it('writes content, creating parent directories', async () => {
    const dir = await tempDir()
    const file = join(dir, 'deep', 'skill', 'SKILL.md')
    await writeTextFileAtomic(file, '---\nname: x\n---\n')
    expect(await readFile(file, 'utf8')).toBe('---\nname: x\n---\n')
  })

  it('enforces expectedHash conflict semantics', async () => {
    const dir = await tempDir()
    const file = join(dir, 'b.md')
    await writeFile(file, 'v1')
    const before = await readTextFile(file)
    await writeFile(file, 'v2') // external change
    await expect(
      writeTextFileAtomic(file, 'v3', { expectedHash: before.hash }),
    ).rejects.toBeInstanceOf(WriteConflictError)
    await expect(writeTextFileAtomic(file, 'v3', { expectedHash: null })).rejects.toBeInstanceOf(
      WriteConflictError,
    )
    const current = await readTextFile(file)
    const after = await writeTextFileAtomic(file, 'v3', { expectedHash: current.hash })
    expect(after.content).toBe('v3')
    expect(await readFile(file, 'utf8')).toBe('v3')
  })
})
