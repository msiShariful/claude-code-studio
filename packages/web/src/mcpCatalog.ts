// A curated, offline catalog of well-known MCP servers. Picking one auto-fills
// the add-server form so users don't have to remember npx incantations. This is
// a static list on purpose — no network calls, in keeping with Studio's
// localhost-only, no-telemetry design. Entries with `needs` require the user to
// replace a placeholder (a path, URL, or token) before the server will work.

export interface McpCatalogEntry {
  /** suggested server name, also the search id */
  id: string
  title: string
  description: string
  command: string
  args: string[]
  /** env keys the server needs, with obvious placeholder values to replace */
  env?: Record<string, string>
  /** one-line hint shown when a placeholder must be filled in */
  needs?: string
  homepage: string
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: 'playwright',
    title: 'Playwright',
    description: 'Drive a real browser — navigate, click, fill, and snapshot pages.',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    homepage: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'filesystem',
    title: 'Filesystem',
    description: 'Read and write files within directories you explicitly allow.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/absolute/path/to/allowed/dir'],
    needs: 'Replace /absolute/path/to/allowed/dir with a directory the server may access.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'A persistent knowledge graph the model can read and update.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning as a tool.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    homepage:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Browse repos, issues, and pull requests; search code.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'YOUR_TOKEN_HERE' },
    needs: 'Set GITHUB_PERSONAL_ACCESS_TOKEN to a token with the scopes you need.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'puppeteer',
    title: 'Puppeteer',
    description: 'Headless Chrome automation and screenshots.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'brave-search',
    title: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: 'YOUR_API_KEY_HERE' },
    needs: 'Set BRAVE_API_KEY to your Brave Search API key.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'postgres',
    title: 'PostgreSQL',
    description: 'Read-only SQL access and schema inspection for a database.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@host/db'],
    needs: 'Replace the connection string with your own postgresql:// URL.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'context7',
    title: 'Context7',
    description: 'Up-to-date library docs and code examples on demand.',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    homepage: 'https://github.com/upstash/context7',
  },
  {
    id: 'slack',
    title: 'Slack',
    description: 'Read channels and post messages to a Slack workspace.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: 'xoxb-YOUR-TOKEN', SLACK_TEAM_ID: 'YOUR_TEAM_ID' },
    needs: 'Set SLACK_BOT_TOKEN and SLACK_TEAM_ID for your workspace.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
]

/** Case-insensitive search over title, id, description, and the command line. */
export function filterCatalog(query: string): readonly McpCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return MCP_CATALOG
  return MCP_CATALOG.filter((e) => {
    const haystack = [e.id, e.title, e.description, e.command, ...e.args].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}
