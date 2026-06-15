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
}

const LOADING: Tile[] = []

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The landing view for a workspace: a card grid of the standard Claude setup,
 * each tile showing whether it is configured and linking to where you manage it.
 * Turns "a pile of config files" into "here's what Claude can do, and what's missing".
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
  const isGlobal = workspace.kind === 'global'
  const [tiles, setTiles] = useState<Tile[]>(LOADING)

  useEffect(() => {
    let live = true
    async function load() {
      const [settings, mcp, files, plugins] = await Promise.all([
        api.settings(projectDir).catch(() => null),
        api.mcp(projectDir).catch(() => null),
        api.files(projectDir).catch(() => null),
        isGlobal ? api.plugins().catch(() => null) : Promise.resolve(null),
      ])
      if (!live) return

      const effective = settings?.effective?.value ?? {}
      const settingKeys = Object.keys(effective).length
      const hooks = isObj(effective.hooks) ? Object.keys(effective.hooks).length : 0
      const servers = (mcp?.servers ?? []).filter((s) =>
        isGlobal ? s.scope === 'user' : s.scope !== 'user',
      ).length
      const scopeFiles = isGlobal ? files?.user : files?.project
      const agents = (scopeFiles?.agents.length ?? 0) + (scopeFiles?.skills.length ?? 0)
      const hasMemory = scopeFiles?.claudeMd.exists ?? false

      const next: Tile[] = [
        {
          section: 'settings',
          status: settingKeys ? `${settingKeys} set` : 'Using defaults',
          tone: settingKeys ? 'ok' : 'muted',
          blurb: 'Model, permission rules, and environment for Claude.',
        },
        {
          section: 'tools',
          status: servers ? `${servers} connected` : 'None yet',
          tone: servers ? 'ok' : 'muted',
          blurb: 'Browsers, databases, GitHub and more, via MCP servers.',
        },
        {
          section: 'agents',
          status:
            agents || hasMemory
              ? [agents ? `${agents} item${agents === 1 ? '' : 's'}` : null, hasMemory ? 'memory set' : null]
                  .filter(Boolean)
                  .join(' · ')
              : 'None yet',
          tone: agents || hasMemory ? 'ok' : 'muted',
          blurb: 'Custom agents, reusable skills, and CLAUDE.md memory.',
        },
        {
          section: 'automation',
          status: hooks ? `${hooks} event${hooks === 1 ? '' : 's'}` : 'None yet',
          tone: hooks ? 'ok' : 'muted',
          blurb: 'Run your own commands automatically on Claude events.',
        },
      ]
      if (isGlobal) {
        const count = plugins?.plugins.length ?? 0
        next.push({
          section: 'extensions',
          status: count ? `${count} installed` : 'None yet',
          tone: count ? 'ok' : 'muted',
          blurb: 'Bundles of agents, commands, and tools from marketplaces.',
        })
      }
      setTiles(next)
    }
    void load()
    return () => {
      live = false
    }
  }, [api, projectDir, isGlobal])

  return (
    <>
      <PageHeader
        title={isGlobal ? 'Global setup' : 'Project setup'}
        info={
          isGlobal
            ? 'Settings here apply to Claude across every project on this machine.'
            : 'Settings here apply only when Claude runs inside this project, layered on top of your global setup.'
        }
        label="This workspace"
      />
      <p className="dim home-intro">
        Everything Claude is set up with {isGlobal ? 'everywhere' : 'in this project'}. Open any card
        to add, change, or remove things — no JSON editing required.
      </p>
      {tiles === LOADING ? (
        <p className="dim">Loading…</p>
      ) : (
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
                <span className="tile-cta">{t.tone === 'muted' ? 'Set up →' : 'Manage →'}</span>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
