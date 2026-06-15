import { useEffect, useState } from 'react'
import type { Api, SettingsResponse } from '../api.js'
import { PageHeader } from '../components/ui.js'
import { flattenLeaves } from '../utils.js'
import type { EditableScope } from './Editor.js'

export function Effective({
  api,
  projectDir,
  onEdit,
}: {
  api: Api
  projectDir: string
  onEdit?: (scope: EditableScope, path: string) => void
}) {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="dim">Loading…</p>

  const leaves = flattenLeaves(data.effective.value, data.effective.sources)

  return (
    <>
      <PageHeader
        title="Effective settings"
        label="Effective Config"
        info="The merged result of every settings file, showing which scope each value comes from."
      />
      {leaves.length === 0 ? (
        <p className="dim">No settings found.</p>
      ) : (
        <table className="kv">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map((leaf) => {
              const editable = leaf.source && leaf.source !== 'managed'
              return (
                <tr
                  key={leaf.path}
                  style={editable && onEdit ? { cursor: 'pointer' } : undefined}
                  title={editable ? 'Click to edit this value at its source scope' : undefined}
                  onClick={
                    editable && onEdit
                      ? () => onEdit(leaf.source as EditableScope, leaf.path)
                      : undefined
                  }
                >
                  <td className="path">{leaf.path}</td>
                  <td className="value">{JSON.stringify(leaf.value)}</td>
                  <td>
                    {leaf.source ? <span className={`badge ${leaf.source}`}>{leaf.source}</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
