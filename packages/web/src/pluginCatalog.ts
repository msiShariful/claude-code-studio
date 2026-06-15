// A curated, offline catalog of well-known Claude Code plugin marketplaces.
// Picking one prefills the "Add marketplace" field so users don't have to
// remember repo slugs. Like the MCP catalog, this is a static list on purpose —
// no network calls, in keeping with Studio's localhost-only, no-telemetry design.
// It's a starting seed; users add any other marketplace by hand below.

export interface PluginCatalogEntry {
  /** suggested marketplace name / search id */
  id: string
  title: string
  description: string
  /** what goes into `claude plugin marketplace add <source>` */
  source: string
  homepage: string
}

export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  {
    id: 'superpowers',
    title: 'Superpowers',
    description:
      'Workflow skills for Claude Code — structured brainstorming, planning, TDD, debugging, and more.',
    source: 'obra/superpowers',
    homepage: 'https://github.com/obra/superpowers',
  },
  {
    id: 'claude-code-templates',
    title: 'Claude Code Templates',
    description:
      'A large community library of agents, slash commands, settings, and MCP setups (aitmpl.com).',
    source: 'davila7/claude-code-templates',
    homepage: 'https://github.com/davila7/claude-code-templates',
  },
]

/** Case-insensitive search over title, id, description, and the marketplace source. */
export function filterPluginCatalog(query: string): readonly PluginCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return PLUGIN_CATALOG
  return PLUGIN_CATALOG.filter((e) => {
    const haystack = [e.id, e.title, e.description, e.source].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}
