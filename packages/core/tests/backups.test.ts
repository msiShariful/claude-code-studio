import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupFile, listBackups, pruneBackups, restoreBackup } from '../src/backups.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ccs-bak-'))
  return { dir, backupsRoot: join(dir, 'backups') }
}

describe('backups', () => {
  it('returns null when the original file does not exist', async () => {
    const { dir, backupsRoot } = await setup()
    expect(await backupFile(join(dir, 'nope.json'), backupsRoot)).toBeNull()
  })

  it('creates a backup, lists it newest-first, and restores it', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{"v": 1}')
    const entry = await backupFile(file, backupsRoot)
    expect(entry?.originalPath).toBe(file)

    await writeFile(file, '{"v": 2}') // user breaks the file
    const [listed] = await listBackups(backupsRoot)
    expect(listed.originalPath).toBe(file)
    await restoreBackup(listed)
    expect(await readFile(file, 'utf8')).toBe('{"v": 1}')
  })

  it('prunes old backups, keeping the newest N per original file', async () => {
    const { dir, backupsRoot } = await setup()
    const file = join(dir, 'a.json')
    await writeFile(file, '{"v": 1}')
    await backupFile(file, backupsRoot)
    await sleep(10)
    await writeFile(file, '{"v": 2}')
    await backupFile(file, backupsRoot)
    await sleep(10)
    await writeFile(file, '{"v": 3}')
    await backupFile(file, backupsRoot)

    const removed = await pruneBackups(backupsRoot, 1)
    expect(removed).toBe(2)
    const remaining = await listBackups(backupsRoot)
    expect(remaining).toHaveLength(1)
    expect(await readFile(remaining[0].backupPath, 'utf8')).toBe('{"v": 3}')
  })

  it('lists nothing for a missing backups root', async () => {
    const { dir } = await setup()
    expect(await listBackups(join(dir, 'no-such-root'))).toEqual([])
  })
})
