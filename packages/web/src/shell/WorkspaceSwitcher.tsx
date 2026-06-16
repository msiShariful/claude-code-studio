import { useEffect, useRef, useState } from 'react'
import type { ProjectDto } from '../api.js'
import { projectName, type Workspace } from '../workspace.js'

/**
 * Top-level switch between the global setup and a specific project. Replaces the
 * old all-in-one sidebar: "where am I configuring" lives here, "what am I looking
 * at" lives in the section nav. Also where projects are added and removed.
 */
export function WorkspaceSwitcher({
  workspace,
  projects,
  extras,
  onSwitch,
  onAddProject,
  onRemoveExtra,
}: {
  workspace: Workspace
  projects: ProjectDto[] | null
  extras: string[]
  onSwitch: (ws: Workspace) => void
  onAddProject: (dir: string) => void
  onRemoveExtra: (dir: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current =
    workspace.kind === 'global'
      ? 'Global'
      : workspace.kind === 'user'
        ? 'User'
        : (projects?.find((p) => p.dir === workspace.dir)?.name ?? projectName(workspace.dir))
  const kindLabel =
    workspace.kind === 'project' ? 'Project' : workspace.kind === 'user' ? 'User' : 'Global'

  function pick(ws: Workspace) {
    onSwitch(ws)
    setOpen(false)
  }

  function submitAdd() {
    const dir = addPath.trim()
    if (!dir) return
    onAddProject(dir)
    setAddPath('')
    setOpen(false)
  }

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        className="ws-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Switch workspace"
      >
        <span className="ws-kind">{kindLabel}</span>
        <span className="ws-current">{current}</span>
        <span className="ws-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="ws-menu" role="menu">
          <button
            className={workspace.kind === 'global' ? 'ws-option active' : 'ws-option'}
            onClick={() => pick({ kind: 'global' })}
          >
            <span className="ws-option-name">Global</span>
            <span className="ws-option-sub">Everything, across all projects</span>
          </button>
          <button
            className={workspace.kind === 'user' ? 'ws-option active' : 'ws-option'}
            onClick={() => pick({ kind: 'user' })}
          >
            <span className="ws-option-name">User</span>
            <span className="ws-option-sub">Your machine-wide ~/.claude config</span>
          </button>

          <div className="ws-menu-label">Projects</div>
          {projects === null && <p className="dim ws-note">Loading…</p>}
          {projects?.length === 0 && <p className="dim ws-note">No projects yet.</p>}
          {projects?.map((p) => (
            <div className="ws-project-row" key={p.dir}>
              <button
                className={
                  workspace.kind === 'project' && workspace.dir === p.dir
                    ? 'ws-option active'
                    : 'ws-option'
                }
                disabled={!p.exists}
                title={p.dir}
                onClick={() => pick({ kind: 'project', dir: p.dir })}
              >
                <span className="ws-option-name">{p.name}</span>
                {!p.exists && <span className="missing-badge">missing</span>}
              </button>
              {extras.includes(p.dir) && (
                <button
                  className="remove-extra"
                  title="Remove from list"
                  onClick={() => onRemoveExtra(p.dir)}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <div className="ws-add">
            <input
              placeholder="/path/to/project"
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd()
              }}
            />
            <button className="ghost" disabled={!addPath.trim()} onClick={submitAdd}>
              + Add project
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
