import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '../src/cli.js'
import { parseMcpHealth, readMcpHealth } from '../src/mcp.js'

describe('parseMcpHealth', () => {
  it('parses the `name: cmd - ✓ Connected / ✗ Failed` rendering', () => {
    const out = [
      'Checking MCP server health...',
      '',
      'context7: npx -y @upstash/context7-mcp - ✓ Connected',
      'filesystem: npx -y @modelcontextprotocol/server-filesystem /p - ✗ Failed to connect',
    ].join('\n')
    expect(parseMcpHealth(out)).toEqual({ context7: 'connected', filesystem: 'failed' })
  })

  it('parses the `name · ✓ connected · N tools` rendering', () => {
    const out = ['context7 · ✓ connected · 2 tools', 'filesystem · ✗ failed'].join('\n')
    expect(parseMcpHealth(out)).toEqual({ context7: 'connected', filesystem: 'failed' })
  })

  it('ignores the health banner and blank lines', () => {
    expect(parseMcpHealth('Checking MCP server health...\n\n')).toEqual({})
  })

  it('keeps server names with dots and dashes', () => {
    expect(parseMcpHealth('sequential-thinking: npx x - ✓ Connected')).toEqual({
      'sequential-thinking': 'connected',
    })
  })
})

describe('readMcpHealth', () => {
  it('runs `claude mcp list` in the project dir and returns parsed status', async () => {
    const runner: CliRunner = vi.fn().mockResolvedValue({
      command: 'claude mcp list',
      exitCode: 0,
      stdout: 'figma: http - ✓ Connected\n',
      stderr: '',
    })
    const result = await readMcpHealth(runner, '/work/app')
    expect(result).toEqual({ available: true, status: { figma: 'connected' } })
    expect(runner).toHaveBeenCalledWith('claude', ['mcp', 'list'], {
      cwd: '/work/app',
      timeoutMs: 60_000,
    })
  })

  it('reports available:false when the CLI is missing', async () => {
    const runner: CliRunner = () => {
      const err = new Error('spawn claude ENOENT') as Error & { code: string }
      err.code = 'ENOENT'
      return Promise.reject(err)
    }
    expect(await readMcpHealth(runner)).toEqual({ available: false, status: {} })
  })
})
