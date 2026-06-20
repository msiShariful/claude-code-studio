import { useEffect, useState } from 'react'
import type { Api } from '../api.js'
import { Card, PageHeader } from '../components/ui.js'
import { Glyph, type TreeIcon } from '../shell/icons.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

interface Tile {
  section: string
  /** the on-disk name, shown as the card's title in mono (matches the sidebar) */
  file: string
  icon: TreeIcon
  /** plain-language role, a small eyebrow above the filename */
  role: string
  status: string
  configured: boolean
  blurb: string
  /** names of the configured items, previewed as chips on the card */
  items: string[]
}

const LOADING: Tile[] = []

const ICON_CLASS: Record<TreeIcon, string> = {
  md: 'ic-md',
  json: 'ic-json',
  folder: 'ic-folder',
  layers: 'ic-derived',
  history: 'ic-derived',
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The landing view for a workspace, drawn as the annotated `.claude/` directory:
 * one card per config file (named in mono, like the sidebar), showing what's set up,
 * a preview of its contents, and a way in. Turns "a pile of config files" into "here's
 * what Claude can do here, and what's still missing".
 */
export function Home({
  api,
  workspace,
  onOpen,
}: {
  api: Api
  workspace: Workspace
  onOpen: (sectionKey: string) => void
}) {
  const projectDir = workspaceProjectDir(workspace) || undefined
  const kind = workspace.kind
  const isProject = kind === 'project'
  const [tiles, setTiles] = useState<Tile[]>(LOADING)

  useEffect(() => {
    let live = true
    async function load() {
      const [settings, mcp, files, plugins] = await Promise.all([
        api.settings(projectDir).catch(() => null),
        api.mcp(projectDir).catch(() => null),
        api.files(projectDir).catch(() => null),
        api.plugins().catch(() => null),
      ])
      if (!live) return

      // Same scope rule as each section: Global aggregates everything, User keeps
      // to user scope, a project keeps to its project/local items.
      const inScope = <T extends { scope: string; projectPath?: string }>(x: T): boolean =>
        kind === 'global'
          ? true
          : kind === 'user'
            ? x.scope === 'user'
            : x.scope !== 'user' && (!x.projectPath || x.projectPath === projectDir)

      const effective = settings?.effective?.value ?? {}
      const settingKeys = Object.keys(effective)
      const hookKeys = isObj(effective.hooks) ? Object.keys(effective.hooks) : []
      const servers = (mcp?.servers ?? []).filter(inScope).map((s) => s.name)
      const scopeFiles = isProject ? files?.project : files?.user
      const agentNames = scopeFiles?.agents.map((a) => a.name) ?? []
      const skillNames = scopeFiles?.skills.map((s) => s.name) ?? []
      const hasMemory = scopeFiles?.claudeMd.exists ?? false
      const ids = (plugins?.plugins ?? []).filter(inScope).map((p) => p.id)

      const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

      // Ordered to read like the sidebar tree, top to bottom.
      setTiles([
        {
          section: 'memory',
          file: 'CLAUDE.md',
          icon: 'md',
          role: 'memory',
          status: hasMemory ? 'in use' : 'empty',
          configured: hasMemory,
          blurb: 'Standing instructions Claude reads at the start of every session.',
          items: [],
        },
        {
          section: 'tools',
          file: '.mcp.json',
          icon: 'json',
          role: 'tools & integrations',
          status: servers.length ? count(servers.length, 'server') : 'none yet',
          configured: servers.length > 0,
          blurb: 'Connect Claude to browsers, databases, GitHub and more, via MCP.',
          items: servers,
        },
        {
          section: 'settings',
          file: 'settings.json',
          icon: 'json',
          role: 'permissions & behavior',
          status: settingKeys.length ? count(settingKeys.length, 'key') : 'defaults',
          configured: settingKeys.length > 0,
          blurb: 'What Claude may do and how it behaves — model, permissions, environment.',
          items: settingKeys,
        },
        {
          section: 'agents',
          file: 'agents/',
          icon: 'folder',
          role: 'subagents',
          status: agentNames.length ? count(agentNames.length, 'agent') : 'none yet',
          configured: agentNames.length > 0,
          blurb: 'Custom subagents you can hand specialized tasks.',
          items: agentNames,
        },
        {
          section: 'skills',
          file: 'skills/',
          icon: 'folder',
          role: 'skills',
          status: skillNames.length ? count(skillNames.length, 'skill') : 'none yet',
          configured: skillNames.length > 0,
          blurb: 'Reusable skills Claude can invoke on demand.',
          items: skillNames,
        },
        {
          section: 'automation',
          file: 'hooks/',
          icon: 'folder',
          role: 'automation',
          status: hookKeys.length ? count(hookKeys.length, 'event') : 'none yet',
          configured: hookKeys.length > 0,
          blurb: 'Shell commands that run automatically on Claude’s lifecycle events.',
          items: hookKeys,
        },
        {
          section: 'extensions',
          file: 'plugins/',
          icon: 'folder',
          role: 'extensions',
          status: ids.length ? count(ids.length, 'plugin') : 'none yet',
          configured: ids.length > 0,
          blurb: 'Bundles of agents, commands, and tools installed from marketplaces.',
          items: ids,
        },
      ])
    }
    void load()
    return () => {
      live = false
    }
  }, [api, projectDir, kind, isProject])

  const loading = tiles === LOADING
  const ready = tiles.filter((t) => t.configured).length
  const nothingConfigured = !loading && ready === 0
  const here = kind === 'global' ? 'on this machine' : kind === 'user' ? 'for your user' : 'in this project'

  return (
    <>
      <PageHeader
        title={kind === 'global' ? 'Global setup' : kind === 'user' ? 'User setup' : 'Project setup'}
        label="This workspace"
        info={
          kind === 'global'
            ? 'Everything Claude is set up with on this machine — your user config plus every project.'
            : kind === 'user'
              ? 'Your machine-wide config in ~/.claude — it applies to Claude across every project.'
              : 'Settings here apply only when Claude runs inside this project, layered on top of your user setup.'
        }
      />
      <p className="dim home-intro">
        Everything Claude runs with {here}.{' '}
        {!loading &&
          (nothingConfigured ? (
            <span className="home-count">nothing set up yet.</span>
          ) : (
            <>
              <span className="home-count">
                {ready} of {tiles.length}
              </span>{' '}
              set up — open a card to change it.
            </>
          ))}
      </p>

      {loading ? (
        <p className="dim">Loading…</p>
      ) : (
        <>
          {nothingConfigured && (
            <div className="home-firstrun">
              <p className="home-firstrun-title">A blank slate</p>
              <p className="dim">
                Nothing is configured here yet. Open any card to add your first tool, agent, or rule —
                Studio writes the file for you and snapshots every change so you can always roll back.
              </p>
            </div>
          )}
          <div className="home-grid">
            {tiles.map((t) => (
              <Card key={t.section} className="home-card" onClick={() => onOpen(t.section)}>
                <div className="home-card-head">
                  <span className={`ic ${ICON_CLASS[t.icon]}`}>
                    <Glyph name={t.icon} />
                  </span>
                  <span className="home-card-name">{t.file}</span>
                  <span className={`home-card-status ${t.configured ? 'on' : 'off'}`}>
                    <span className="home-dot" aria-hidden="true" />
                    {t.status}
                  </span>
                </div>
                <span className="home-card-role">{t.role}</span>
                <p className="home-card-blurb">{t.blurb}</p>
                {t.items.length > 0 && (
                  <div className="home-card-chips">
                    {t.items.slice(0, 3).map((name) => (
                      <span className="chip" key={name}>
                        {name}
                      </span>
                    ))}
                    {t.items.length > 3 && <span className="chip more">+{t.items.length - 3}</span>}
                  </div>
                )}
                <span className="home-card-cta">{t.configured ? 'Manage →' : 'Set up →'}</span>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
