// Single source of truth for the section navigation. The sidebar, the breadcrumb,
// the routes, and the info tooltips all derive from this list, so adding a section
// is a one-line change. Labels are plain-language; `tech` + `info` teach the
// underlying Claude concept for people who don't know the jargon yet.

export type Scope = 'global' | 'project' | 'both'

export interface Section {
  /** url segment, e.g. /global/<key> */
  key: string
  /** plain-language label shown in the sidebar */
  label: string
  /** the technical Claude term, surfaced in the info tooltip */
  tech: string
  /** one-line explanation a newcomer can understand */
  info: string
  /** which workspaces this section applies to */
  scope: Scope
}

export const SECTIONS: readonly Section[] = [
  {
    key: 'home',
    label: 'Home',
    tech: 'Workspace overview',
    info: 'A dashboard of everything Claude is set up with here, with quick actions to fill the gaps.',
    scope: 'both',
  },
  {
    key: 'settings',
    label: 'Permissions & Behavior',
    tech: 'settings.json',
    info: "Controls what Claude is allowed to do and how it behaves — model, permission rules, environment. Stored in Claude's settings.json files.",
    scope: 'both',
  },
  {
    key: 'tools',
    label: 'Tools & Integrations',
    tech: 'MCP servers',
    info: 'Connect Claude to external tools and data — browsers, databases, GitHub, and more — through MCP servers.',
    scope: 'both',
  },
  {
    key: 'agents',
    label: 'Agents & Files',
    tech: 'agents, skills & CLAUDE.md',
    info: 'Custom agents, reusable skills, and the CLAUDE.md memory files that give Claude standing instructions.',
    scope: 'both',
  },
  {
    key: 'automation',
    label: 'Automation',
    tech: 'hooks',
    info: 'Run your own commands automatically when Claude does something — for example, format code after every edit. These are hooks.',
    scope: 'both',
  },
  {
    key: 'extensions',
    label: 'Extensions',
    tech: 'plugins & marketplaces',
    info: 'Install plugins from marketplaces to add bundles of agents, commands, and tools in one step.',
    scope: 'global',
  },
  {
    key: 'effective',
    label: 'Effective Config',
    tech: 'merged settings',
    info: 'The settings Claude actually uses here after global and project files are merged — and which file each value comes from.',
    scope: 'project',
  },
  {
    key: 'history',
    label: 'History & Backups',
    tech: 'backups',
    info: 'Every change Studio makes is backed up first. Restore any earlier version of a config file from here.',
    scope: 'global',
  },
]

export function sectionsFor(kind: 'global' | 'project'): Section[] {
  return SECTIONS.filter((s) => s.scope === 'both' || s.scope === kind)
}

export function sectionByKey(key: string): Section | undefined {
  return SECTIONS.find((s) => s.key === key)
}
