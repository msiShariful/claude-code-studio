import { useEffect, useState } from 'react'
import type { Api, BackupEntryDto, HealthDto, SettingsResponse } from '../api.js'
import { flattenLeaves } from '../utils.js'

export function Dashboard({ api, projectDir }: { api: Api; projectDir: string }) {
  const [health, setHealth] = useState<HealthDto | null>(null)
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [backups, setBackups] = useState<BackupEntryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    Promise.all([api.health(), api.settings(projectDir || undefined), api.backups()])
      .then(([h, s, b]) => {
        setHealth(h)
        setSettings(s)
        setBackups(b.backups)
      })
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!health || !settings || !backups) return <p className="dim">Loading…</p>

  const present = settings.entries.filter((e) => e.state.exists)
  const broken = settings.entries.filter((e) => e.state.parseError)
  const keyCount = flattenLeaves(settings.effective.value, settings.effective.sources).length

  return (
    <>
      <h2>Dashboard</h2>
      <div className="cards">
        <div className="card">
          <div className="label">Claude CLI</div>
          <div className={health.cli.found ? 'figure ok' : 'figure bad'}>
            {health.cli.found ? (health.cli.version ?? 'found') : 'not found'}
          </div>
        </div>
        <div className="card">
          <div className="label">Settings files</div>
          <div className="figure">{present.length}</div>
        </div>
        <div className="card">
          <div className="label">Effective keys</div>
          <div className="figure">{keyCount}</div>
        </div>
        <div className="card">
          <div className="label">Backups</div>
          <div className="figure">{backups.length}</div>
        </div>
      </div>
      {broken.length > 0 && (
        <div className="alert error">
          {broken.length} settings file{broken.length > 1 ? 's' : ''} failed to parse:{' '}
          {broken.map((b) => b.state.path).join(', ')}
        </div>
      )}
      <h2>Files</h2>
      <table className="kv">
        <thead>
          <tr>
            <th>Scope</th>
            <th>File</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {settings.entries.map((entry) => (
            <tr key={entry.scope}>
              <td>
                <span className={`badge ${entry.scope}`}>{entry.scope}</span>
              </td>
              <td className="value">{entry.state.path}</td>
              <td className="dim">
                {entry.state.parseError
                  ? 'parse error'
                  : entry.state.exists
                    ? entry.editable
                      ? 'present'
                      : 'present (read-only)'
                    : 'absent'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
