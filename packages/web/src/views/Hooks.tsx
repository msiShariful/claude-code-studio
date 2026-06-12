import { useEffect, useState } from 'react'
import type { Api, SettingsResponse, SettingsScope } from '../api.js'

const HOOK_EVENTS: ReadonlyArray<[string, string]> = [
  ['PreToolUse', 'Runs before a tool call; can block or modify it.'],
  ['PostToolUse', 'Runs after a tool call completes.'],
  ['UserPromptSubmit', 'Runs when you submit a prompt, before Claude sees it.'],
  ['Notification', 'Runs when Claude Code sends a notification.'],
  ['Stop', 'Runs when Claude finishes responding.'],
  ['SubagentStop', 'Runs when a subagent finishes.'],
  ['PreCompact', 'Runs before the conversation context is compacted.'],
  ['SessionStart', 'Runs when a session starts or resumes.'],
  ['SessionEnd', 'Runs when a session ends.'],
]

type EditableScope = 'user' | 'project' | 'projectLocal'

export function Hooks({
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
    api
      .settings(projectDir || undefined)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [api, projectDir])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="dim">Loading…</p>

  function hooksFor(scope: SettingsScope, event: string): unknown {
    const entry = data!.entries.find((e) => e.scope === scope)
    const hooks = entry?.state.value?.hooks
    if (typeof hooks !== 'object' || hooks === null) return undefined
    return (hooks as Record<string, unknown>)[event]
  }

  const editableScopes = data.entries
    .filter((e) => e.editable)
    .map((e) => e.scope) as EditableScope[]

  return (
    <>
      <h2>Hooks</h2>
      <p className="dim">
        Hooks run shell commands at lifecycle events — they live under the <code>hooks</code> key
        of your settings files. Treat them like code you ship to yourself: review every command.
      </p>
      {HOOK_EVENTS.map(([event, description]) => {
        const configured = editableScopes
          .map((scope) => ({ scope, config: hooksFor(scope, event) }))
          .filter((c) => c.config !== undefined)
        return (
          <div className="card" key={event} style={{ marginBottom: '1rem' }}>
            <div className="label">{event}</div>
            <p className="dim" style={{ margin: '0.25rem 0 0.75rem' }}>
              {description}
            </p>
            {configured.length === 0 ? (
              <p className="dim" style={{ margin: 0 }}>
                Not configured.
              </p>
            ) : (
              configured.map(({ scope, config }) => (
                <div key={scope} style={{ marginBottom: '0.5rem' }}>
                  <span className={`badge ${scope}`}>{scope}</span>
                  <pre className="code" style={{ marginTop: '0.4rem' }}>
                    {JSON.stringify(config, null, 2)}
                  </pre>
                </div>
              ))
            )}
            {onEdit && (
              <div className="toolbar" style={{ margin: 0 }}>
                {(configured.length > 0
                  ? configured.map((c) => c.scope)
                  : (['user'] as EditableScope[])
                ).map((scope) => (
                  <button
                    key={scope}
                    className="ghost"
                    onClick={() => onEdit(scope, `hooks.${event}`)}
                  >
                    Edit in Editor
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
