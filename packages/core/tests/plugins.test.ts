import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '../src/cli.js'
import {
  listAvailablePlugins,
  listMarketplaces,
  listPlugins,
  marketplaceAction,
  pluginAction,
  readProjectEnabledPlugins,
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

describe('listAvailablePlugins', () => {
  const MARKETPLACES = [
    { name: 'official', source: 'github', repo: 'a/b', installLocation: '/m/official' },
    { name: 'mine', source: 'github', repo: 'me/x', installLocation: '/m/mine' },
  ]

  function fakeReader(files: Record<string, string>) {
    return async (path: string) => {
      const hit = files[path]
      if (hit === undefined) throw new Error(`ENOENT ${path}`)
      return hit
    }
  }

  it('reads each marketplace manifest and flattens its plugins with name@marketplace ids', async () => {
    const reader = fakeReader({
      '/m/official/.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [
          {
            name: 'code-review',
            description: 'Automated code review',
            author: { name: 'Anthropic' },
            category: 'development',
            homepage: 'https://x',
          },
          { name: 'superpowers', description: 'Workflow skills', author: 'Jesse' },
        ],
      }),
      '/m/mine/.claude-plugin/marketplace.json': JSON.stringify({
        plugins: [{ name: 'token-inspector', description: 'Inspect context' }],
      }),
    })
    const out = await listAvailablePlugins(MARKETPLACES, reader)
    expect(out).toEqual([
      {
        installId: 'code-review@official',
        name: 'code-review',
        marketplace: 'official',
        description: 'Automated code review',
        author: 'Anthropic',
        category: 'development',
        homepage: 'https://x',
      },
      {
        installId: 'superpowers@official',
        name: 'superpowers',
        marketplace: 'official',
        description: 'Workflow skills',
        author: 'Jesse',
      },
      {
        installId: 'token-inspector@mine',
        name: 'token-inspector',
        marketplace: 'mine',
        description: 'Inspect context',
      },
    ])
  })

  it('skips marketplaces with a missing or invalid manifest', async () => {
    const reader = fakeReader({
      '/m/mine/.claude-plugin/marketplace.json': 'not json',
    })
    // official manifest is absent (reader throws), mine is invalid JSON → both skipped
    expect(await listAvailablePlugins(MARKETPLACES, reader)).toEqual([])
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

  it('appends --scope and runs in the project cwd for per-project actions', async () => {
    const runner = jsonRunner({})
    await pluginAction(runner, 'disable', 'foo@bar', { scope: 'local', cwd: '/work/app' })
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual([
      'plugin',
      'disable',
      'foo@bar',
      '--scope',
      'local',
    ])
    expect(vi.mocked(runner).mock.calls[0][2]).toMatchObject({ cwd: '/work/app' })
  })

  it('rejects an unknown scope', async () => {
    const runner = jsonRunner({})
    await expect(
      pluginAction(runner, 'enable', 'foo@bar', { scope: 'galaxy' as never }),
    ).rejects.toThrow(/scope/)
  })
})

describe('readProjectEnabledPlugins', () => {
  async function projectFixture(
    settings?: Record<string, unknown>,
    local?: Record<string, unknown>,
  ): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ccs-plugin-proj-'))
    await mkdir(join(dir, '.claude'), { recursive: true })
    if (settings) await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify(settings))
    if (local) await writeFile(join(dir, '.claude', 'settings.local.json'), JSON.stringify(local))
    return dir
  }

  it('returns an empty map when the project has no settings', async () => {
    const dir = await projectFixture()
    expect(await readProjectEnabledPlugins(dir)).toEqual({})
  })

  it('reads enabledPlugins, with local settings overriding project settings', async () => {
    const dir = await projectFixture(
      { enabledPlugins: { 'a@m': true, 'b@m': true } },
      { enabledPlugins: { 'b@m': false, 'c@m': true } },
    )
    expect(await readProjectEnabledPlugins(dir)).toEqual({
      'a@m': true,
      'b@m': false, // local false wins over project true
      'c@m': true,
    })
  })

  it('ignores non-boolean entries and a non-object enabledPlugins', async () => {
    const dir = await projectFixture({ enabledPlugins: { 'a@m': 'yes', 'b@m': true } }, {})
    expect(await readProjectEnabledPlugins(dir)).toEqual({ 'b@m': true })
  })
})
