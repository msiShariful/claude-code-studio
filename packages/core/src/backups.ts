import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface BackupEntry {
  backupPath: string
  originalPath: string
  /** filesystem-safe ISO timestamp, e.g. 2026-06-11T12-30-00-000Z */
  timestamp: string
}

function timestampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Backup file name format: `<timestamp>__<encodeURIComponent(originalPath)>` */
export async function backupFile(
  originalPath: string,
  backupsRoot: string,
): Promise<BackupEntry | null> {
  try {
    await stat(originalPath)
  } catch {
    return null
  }
  await mkdir(backupsRoot, { recursive: true })
  const timestamp = timestampNow()
  const backupPath = join(backupsRoot, `${timestamp}__${encodeURIComponent(originalPath)}`)
  await copyFile(originalPath, backupPath)
  return { backupPath, originalPath, timestamp }
}

export async function listBackups(backupsRoot: string): Promise<BackupEntry[]> {
  let names: string[]
  try {
    names = await readdir(backupsRoot)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    const sep = name.indexOf('__')
    if (sep === -1) continue
    entries.push({
      backupPath: join(backupsRoot, name),
      timestamp: name.slice(0, sep),
      originalPath: decodeURIComponent(name.slice(sep + 2)),
    })
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export async function restoreBackup(entry: BackupEntry): Promise<void> {
  await copyFile(entry.backupPath, entry.originalPath)
}

export async function pruneBackups(backupsRoot: string, keepPerFile = 20): Promise<number> {
  const all = await listBackups(backupsRoot)
  const byOriginal = new Map<string, BackupEntry[]>()
  for (const entry of all) {
    const list = byOriginal.get(entry.originalPath) ?? []
    list.push(entry)
    byOriginal.set(entry.originalPath, list)
  }
  let removed = 0
  for (const list of byOriginal.values()) {
    for (const stale of list.slice(keepPerFile)) {
      await rm(stale.backupPath)
      removed++
    }
  }
  return removed
}
