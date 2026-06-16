import { useEffect, useState } from 'react'
import type { Api } from '../api.js'
import { Card, PageHeader, StatusPill, type Tone } from '../components/ui.js'
import { sectionByKey } from '../nav.js'
import { workspaceProjectDir, type Workspace } from '../workspace.js'

interface Tile {
  section: string
  status: string
  tone: Tone
  blurb: string
  /** names of the configured items, previewed as chips on the card */
  items: string[]
}

const LOADING: Tile[] = []

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The landing view for a workspace: a card grid of the standard Claude setup,
 * each tile showing what is configured (with a preview of the items) and linking
 * to where you manage it. Turns "a pile of config files" into "here's what Claude
 * can do here, and what's still missing".
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
      const agentNames = [
        ...(scopeFiles?.agents.map((a) => a.name) ?? []),
        ...(scopeFiles?.skills.map((s) => s.name) ?? []),
      ]
      const hasMemory = scopeFiles?.claudeMd.exists ?? false
      const agentItems = [...(hasMemory ? ['CLAUDE.md'] : []), ...agentNames]

      const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

      const next: Tile[] = [
        {
          section: 'settings',
          status: settingKeys.length ? `${settingKeys.length} set` : 'Using defaults',
          tone: settingKeys.length ? 'ok' : 'muted',
          blurb: 'Model, permission rules, and environment for Claude.',
          items: settingKeys,
        },
        {
          section: 'tools',
          status: servers.length ? `${servers.length} connected` : 'None yet',
          tone: servers.length ? 'ok' : 'muted',
          blurb: 'Browsers, databases, GitHub and more, via MCP servers.',
          items: servers,
        },
        {
          section: 'agents',
          status: agentItems.length ? count(agentItems.length, 'item') : 'None yet',
          tone: agentItems.length ? 'ok' : 'muted',
          blurb: 'Custom agents, reusable skills, and CLAUDE.md memory.',
          items: agentItems,
        },
        {
          section: 'automation',
          status: hookKeys.length ? count(hookKeys.length, 'event') : 'None yet',
          tone: hookKeys.length ? 'ok' : 'muted',
          blurb: 'Run your own commands automatically on Claude events.',
          items: hookKeys,
        },
      ]
      const ids = (plugins?.plugins ?? []).filter(inScope).map((p) => p.id)
      next.push({
        section: 'extensions',
        status: ids.length ? `${ids.length} installed` : 'None yet',
        tone: ids.length ? 'ok' : 'muted',
        blurb: 'Bundles of agents, commands, and tools from marketplaces.',
        items: ids,
      })
      setTiles(next)
    }
    void load()
    return () => {
      live = false
    }
  }, [api, projectDir, kind, isProject])

  const loading = tiles === LOADING
  const nothingConfigured = !loading && tiles.every((t) => t.tone === 'muted')

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
        Everything Claude is set up with{' '}
        {kind === 'global' ? 'on this machine' : kind === 'user' ? 'for your user' : 'in this project'}
        . Open any card to add, change, or remove things — no JSON editing required.
      </p>

      {loading ? (
        <p className="dim">Loading…</p>
      ) : (
        <>
          {nothingConfigured && (
            <div className="home-firstrun">
              <p className="home-firstrun-title">Claude isn’t set up here yet</p>
              <p className="dim">
                Pick a card below to add your first tool, agent, or rule. Studio writes the config
                for you and snapshots every change so you can always roll back.
              </p>
            </div>
          )}
          <div className="tile-grid">
            {tiles.map((t) => {
              const sec = sectionByKey(t.section)!
              return (
                <Card key={t.section} className="tile" onClick={() => onOpen(t.section)}>
                  <div className="tile-head">
                    <span className="tile-title">{sec.label}</span>
                    <StatusPill tone={t.tone}>{t.status}</StatusPill>
                  </div>
                  <p className="tile-blurb">{t.blurb}</p>
                  {t.items.length > 0 && (
                    <div className="tile-items">
                      {t.items.slice(0, 3).map((name) => (
                        <span className="chip" key={name}>
                          {name}
                        </span>
                      ))}
                      {t.items.length > 3 && (
                        <span className="chip more">+{t.items.length - 3}</span>
                      )}
                    </div>
                  )}
                  <span className="tile-cta">{t.tone === 'muted' ? 'Set up →' : 'Manage →'}</span>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
