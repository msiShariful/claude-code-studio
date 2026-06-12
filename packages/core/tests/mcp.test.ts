import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGlobalPaths } from '../src/paths.js'
import { readMcpServers } from '../src/mcp.js'

export async function mcpFixture() {
  const home = await mkdtemp(join(tmpdir(), 'ccs-mcp-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'ccs-mcp-proj-'))
  const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(global.configDir, { recursive: true })
  return { home, projectDir, global }
}

describe('readMcpServers', () => {
  it('reads user-scope servers from ~/.claude.json mcpServers', async () => {
    const { global } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://x/mcp' } } }),
    )
    const result = await readMcpServers(global)
    expect(result.servers).toEqual([
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x/mcp' } },
    ])
    expect(result.warnings).toEqual([])
  })

  it('reads local and project scopes when projectDir is given', async () => {
    const { global, projectDir } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      JSON.stringify({
        mcpServers: {},
        projects: {
          [projectDir]: {
            mcpServers: { playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'] } },
          },
        },
      }),
    )
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { shared: { type: 'sse', url: 'https://y/sse' } } }),
    )
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([
      {
        name: 'playwright',
        scope: 'local',
        config: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'] },
      },
      { name: 'shared', scope: 'project', config: { type: 'sse', url: 'https://y/sse' } },
    ])
  })

  it('returns empty results when no files exist', async () => {
    const { global, projectDir } = await mcpFixture()
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('surfaces parse errors as warnings instead of throwing', async () => {
    const { global, projectDir } = await mcpFixture()
    await writeFile(global.claudeJson, '{oops')
    await writeFile(join(projectDir, '.mcp.json'), '{also bad')
    const result = await readMcpServers(global, projectDir)
    expect(result.servers).toEqual([])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain(global.claudeJson)
  })

  it('skips prototype-polluting names defensively', async () => {
    const { global } = await mcpFixture()
    await writeFile(
      global.claudeJson,
      `{"mcpServers": ${'{"__proto__": {"type": "stdio"}, "ok": {"type": "stdio", "command": "x"}}'}}`,
    )
    const result = await readMcpServers(global)
    expect(result.servers.map((s) => s.name)).toEqual(['ok'])
  })
})
