import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../api.js'
import { InfoTip } from '../components/ui.js'
import type { EditableScope, EditorScope } from '../views/Editor.js'
import { projectName, workspaceProjectDir, type Workspace, type WorkspaceKind } from '../workspace.js'
import { fileTree, flattenTree, type TreeNode } from './fileTree.js'
import { Caret, Glyph } from './icons.js'

/** Colour class per icon, tying file type to meaning (md = amber, json = violet, …). */
const ICON_CLASS: Record<TreeNode['icon'], string> = {
  md: 'ic-md',
  json: 'ic-json',
  folder: 'ic-folder',
  layers: 'ic-derived',
  history: 'ic-derived',
}

/**
 * The two settings files share the `settings` section but map to different scope
 * tabs in the Editor — so they open the editor *at that tab* instead of plain
 * navigating, which would always land on the default tab.
 */
function settingsScopeFor(nodeId: string, kind: WorkspaceKind): EditableScope | undefined {
  if (nodeId === 'settings') return kind === 'project' ? 'project' : 'user'
  if (nodeId === 'settings-local') return 'projectLocal'
  return undefined
}

/** Inverse of `settingsScopeFor`: which tree node a settings tab maps back to. */
const SCOPE_NODE: Record<EditorScope, string> = {
  project: 'settings',
  user: 'settings',
  managed: 'settings',
  projectLocal: 'settings-local',
}

/**
 * The section navigation, drawn as the real Claude Code config tree. Every node is
 * an artifact you'd find on disk; clicking one opens the view that manages it. A
 * status dot marks what's configured here; the plain-language meaning lives in the
 * hover InfoTip so the filenames can stand on their own.
 */
export function Sidebar({
  workspace,
  api,
  active,
  settingsScope,
  onOpen,
  onEditSettings,
}: {
  workspace: Workspace
  api: Api
  active: string
  /** the Editor's open settings tab, so the tree mirrors tab clicks (null when not in Settings) */
  settingsScope?: EditorScope | null
  onOpen: (section: string) => void
  /** open the Settings editor focused on a specific scope tab (settings.json vs .local) */
  onEditSettings: (scope: EditableScope) => void
}) {
  const kind = workspace.kind
  const projectDir = workspaceProjectDir(workspace) || undefined
  const nodes = useMemo(() => fileTree(kind), [kind])
  const flat = useMemo(() => flattenTree(nodes), [nodes])

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, boolean>>({})

  // Reset transient state when the workspace changes.
  useEffect(() => {
    setOpen({})
    setSelected(null)
  }, [kind, projectDir])

  // Status dots reflect what's actually set up here — same scope rules as Home.
  useEffect(() => {
    let live = true
    void (async () => {
      const [settings, mcp, files, plugins] = await Promise.all([
        api.settings(projectDir).catch(() => null),
        api.mcp(projectDir).catch(() => null),
        api.files(projectDir).catch(() => null),
        api.plugins().catch(() => null),
      ])
      if (!live) return
      const inScope = <T extends { scope: string; projectPath?: string }>(x: T): boolean =>
        kind === 'global'
          ? true
          : kind === 'user'
            ? x.scope === 'user'
            : x.scope !== 'user' && (!x.projectPath || x.projectPath === projectDir)
      const effective = settings?.effective?.value ?? {}
      const hooks = effective.hooks
      const hookKeys = hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? Object.keys(hooks) : []
      const entries = settings?.entries ?? []
      const keyCount = (scope: string): number => {
        const v = entries.find((e) => e.scope === scope)?.state.value
        return v ? Object.keys(v).length : 0
      }
      const scopeFiles = kind === 'project' ? files?.project : files?.user
      setStatus({
        'claude-md': scopeFiles?.claudeMd.exists ?? false,
        'mcp-json': (mcp?.servers ?? []).filter(inScope).length > 0,
        settings: keyCount(kind === 'project' ? 'project' : 'user') > 0,
        'settings-local': keyCount('projectLocal') > 0,
        agents: (scopeFiles?.agents.length ?? 0) > 0,
        skills: (scopeFiles?.skills.length ?? 0) > 0,
        hooks: hookKeys.length > 0,
        plugins: (plugins?.plugins ?? []).filter(inScope).length > 0,
      })
    })()
    return () => {
      live = false
    }
  }, [api, kind, projectDir])

  // Which row glows: in Settings the Editor's open tab wins (so clicking a tab
  // moves the highlight too); otherwise the row you last clicked when it still
  // matches the route, else the canonical node for the active section.
  const activeId = useMemo(() => {
    if (active === 'settings' && settingsScope) {
      const id = SCOPE_NODE[settingsScope]
      if (flat.some((n) => n.id === id)) return id
    }
    if (selected) {
      const node = flat.find((n) => n.id === selected)
      if (node && node.section === active) return selected
    }
    return flat.find((n) => n.section === active)?.id ?? null
  }, [settingsScope, selected, active, flat])

  const rootLabel =
    kind === 'project' ? projectName(workspace.dir) : kind === 'user' ? '~' : 'all scopes'

  function navigate(node: TreeNode) {
    if (!node.section) return
    setSelected(node.id)
    const scope = settingsScopeFor(node.id, kind)
    if (scope) onEditSettings(scope)
    else onOpen(node.section)
  }

  return (
    <nav className="file-tree" aria-label="Sections">
      <button
        type="button"
        className={`tree-row tree-root${active === 'home' ? ' active' : ''}`}
        onClick={() => {
          setSelected(null)
          onOpen('home')
        }}
        title="Workspace overview"
      >
        <span className="tree-indent" aria-hidden="true" />
        <span className="ic ic-folder">
          <Glyph name="folder" />
        </span>
        <span className="tree-label tree-root-label">{rootLabel}</span>
      </button>

      <ul className="tree-children tree-root-children">
        {nodes.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            open={open}
            status={status}
            activeId={activeId}
            onToggle={(id) =>
              setOpen((o) => ({ ...o, [id]: !(o[id] ?? node.defaultOpen ?? false) }))
            }
            onNavigate={navigate}
          />
        ))}
      </ul>
    </nav>
  )
}

function TreeRow({
  node,
  open,
  status,
  activeId,
  onToggle,
  onNavigate,
}: {
  node: TreeNode
  open: Record<string, boolean>
  status: Record<string, boolean>
  activeId: string | null
  onToggle: (id: string) => void
  onNavigate: (node: TreeNode) => void
}) {
  const isFolder = !!node.children
  const expanded = open[node.id] ?? node.defaultOpen ?? false
  const isActive = node.id === activeId
  const hasDot = node.id in status

  return (
    <li className="tree-node">
      <div className="tree-row-wrap">
        <button
          type="button"
          className={`tree-row${isActive ? ' active' : ''}`}
          aria-expanded={isFolder ? expanded : undefined}
          onClick={() => (isFolder ? onToggle(node.id) : onNavigate(node))}
        >
          {isFolder ? (
            <Caret open={expanded} />
          ) : (
            <span className="tree-indent" aria-hidden="true" />
          )}
          <span className={`ic ${ICON_CLASS[node.icon]}`}>
            <Glyph name={node.icon} />
          </span>
          <span className="tree-label">{node.label}</span>
          {hasDot && (
            <span
              className={`tree-dot ${status[node.id] ? 'on' : 'off'}`}
              data-testid={`dot-${node.id}`}
              aria-hidden="true"
            />
          )}
        </button>
        <InfoTip text={node.info} label={node.label} />
      </div>
      {isFolder && expanded && (
        <ul className="tree-children">
          {node.children!.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              open={open}
              status={status}
              activeId={activeId}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
