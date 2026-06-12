import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '../src/cli.js'
import {
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
} from '../src/plugins.js'

function jsonRunner(payload: unknown): CliRunner {
  return vi.fn().mockResolvedValue({
    command: 'c',
    exitCode: 0,
    stdout: JSON.stringify(payload),
    stderr: '',
  })
}

const PLUGIN = {
  id: 'superpowers@claude-plugins-official',
  version: '5.1.0',
  scope: 'user',
  enabled: true,
  installPath: '/x',
  installedAt: 't',
  lastUpdated: 't',
}

describe('listPlugins / listMarketplaces', () => {
  it('parses claude plugin list --json', async () => {
    const runner = jsonRunner([PLUGIN])
    expect(await listPlugins(runner)).toEqual([PLUGIN])
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'list', '--json'])
  })

  it('parses claude plugin marketplace list --json', async () => {
    const market = { name: 'official', source: 'github', repo: 'a/b', installLocation: '/m' }
    const runner = jsonRunner([market])
    expect(await listMarketplaces(runner)).toEqual([market])
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'marketplace', 'list', '--json'])
  })

  it('throws a readable error when the CLI returns non-zero', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 1, stdout: '', stderr: 'broken' })
    await expect(listPlugins(runner)).rejects.toThrow(/broken/)
  })

  it('throws a readable error on non-JSON output', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: 'warning: not json', stderr: '' })
    await expect(listPlugins(runner)).rejects.toThrow(/JSON/)
  })
})

describe('pluginAction / marketplaceAction', () => {
  it('passes allowlisted actions through with a long timeout for installs', async () => {
    const runner = jsonRunner({})
    await pluginAction(runner, 'install', 'foo@bar')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'install', 'foo@bar'])
    expect(vi.mocked(runner).mock.calls[0][2]).toMatchObject({ timeoutMs: 120_000 })
  })

  it('rejects unknown actions and flag-like identifiers', async () => {
    const runner = jsonRunner({})
    await expect(
      pluginAction(runner, 'destroy' as never, 'foo@bar'),
    ).rejects.toThrow(/action/)
    await expect(pluginAction(runner, 'enable', '--config evil')).rejects.toThrow(/identifier/)
    await expect(marketplaceAction(runner, 'add', '-rf')).rejects.toThrow(/identifier/)
  })

  it('runs marketplace add/remove', async () => {
    const runner = jsonRunner({})
    await marketplaceAction(runner, 'add', 'org/repo')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['plugin', 'marketplace', 'add', 'org/repo'])
  })
})
