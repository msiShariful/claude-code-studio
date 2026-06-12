import { useCallback, useEffect, useState } from 'react'
import type { Api, BackupEntryDto } from '../api.js'

export function Backups({ api }: { api: Api }) {
  const [backups, setBackups] = useState<BackupEntryDto[] | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(() => {
    api
      .backups()
      .then((b) => setBackups(b.backups))
      .catch((e: Error) => {
        setMessage({ kind: 'error', text: e.message })
        setBackups([])
      })
  }, [api])

  useEffect(() => reload(), [reload])

  async function restore(entry: BackupEntryDto) {
    if (!window.confirm(`Restore this backup over ${entry.originalPath}?`)) return
    setMessage(null)
    try {
      await api.restore(entry.backupPath)
      setMessage({ kind: 'ok', text: `Restored ${entry.originalPath}` })
      reload()
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    }
  }

  if (!backups) return <p className="dim">Loading…</p>

  return (
    <>
      <h2>Backups</h2>
      <p className="dim">
        Studio snapshots every file before changing it. Restore puts the snapshot back.
      </p>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      {backups.length === 0 ? (
        <p className="dim">No backups yet — they appear after your first applied change.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.backupPath}>
                <td className="dim">{b.timestamp}</td>
                <td className="value">{b.originalPath}</td>
                <td>
                  <button className="ghost" onClick={() => void restore(b)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
