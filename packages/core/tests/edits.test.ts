import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBackups } from '../src/backups.js'
import { readJsonFile, WriteConflictError } from '../src/json-file.js'
import { applyChange, planJsonUpdate } from '../src/edits.js'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ccs-edit-'))
  return { dir, backupsRoot: join(dir, 'backups') }
}

describe('planJsonUpdate', () => {
  it('sets nested values, creating intermediate objects, and preserves unknown keys', async () => {
    const { dir } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"customUnknownKey": true, "env": {"A": "1"}}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [
      { path: 'env.B', value: '2' },
      { path: 'permissions.defaultMode', value: 'acceptEdits' },
    ])
    expect(change.nextValue).toEqual({
      customUnknownKey: true,
      env: { A: '1', B: '2' },
      permissions: { defaultMode: 'acceptEdits' },
    })
    expect(change.diff).toContain('+    "B": "2"')
  })

  it('removes keys', async () => {
    const { dir } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus", "env": {"A": "1"}}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'env.A', remove: true }])
    expect(change.nextValue).toEqual({ model: 'opus', env: {} })
  })

  it('plans creation of a file that does not exist yet', async () => {
    const { dir } = await setup()
    const state = await readJsonFile<Record<string, unknown>>(join(dir, 'new.json'))
    const change = planJsonUpdate(state, [{ path: 'model', value: 'opus' }])
    expect(change.expectedHash).toBeNull()
    expect(change.nextValue).toEqual({ model: 'opus' })
  })

  it('refuses to edit a file with a parse error', async () => {
    const { dir } = await setup()
    const file = join(dir, 'bad.json')
    await writeFile(file, '{oops')
    const state = await readJsonFile<Record<string, unknown>>(file)
    expect(() => planJsonUpdate(state, [{ path: 'a', value: 1 }])).toThrow(/not valid JSON/)
  })
})

describe('applyChange', () => {
  it('backs up the file, then writes atomically', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus"}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'model', value: 'sonnet' }])
    await applyChange(change, backupsRoot)

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'sonnet' })
    const backups = await listBackups(backupsRoot)
    expect(backups).toHaveLength(1)
    expect(await readFile(backups[0].backupPath, 'utf8')).toBe('{"model": "opus"}')
  })

  it('rejects with WriteConflictError when the file changed after planning', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 's.json')
    await writeFile(file, '{"model": "opus"}')
    const state = await readJsonFile<Record<string, unknown>>(file)
    const change = planJsonUpdate(state, [{ path: 'model', value: 'sonnet' }])
    await writeFile(file, '{"model": "haiku"}') // external change
    await expect(applyChange(change, backupsRoot)).rejects.toBeInstanceOf(WriteConflictError)
  })
})
