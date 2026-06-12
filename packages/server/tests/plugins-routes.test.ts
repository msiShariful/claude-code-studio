import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
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

function listRunner(): CliRunner {
  return vi.fn().mockImplementation((_bin: string, args: string[]) => {
    const payload = args.includes('marketplace')
      ? [{ name: 'official', source: 'github', repo: 'a/b', installLocation: '/m' }]
      : [PLUGIN]
    return Promise.resolve({ command: 'c', exitCode: 0, stdout: JSON.stringify(payload), stderr: '' })
  })
}

describe('/api/plugins', () => {
  it('requires auth', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/plugins' })
    expect(res.statusCode).toBe(401)
  })

  it('lists plugins and marketplaces when the CLI is present', async () => {
    const { app } = await fixture({ runner: listRunner() })
    const res = await app.inject({ url: '/api/plugins', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cliFound).toBe(true)
    expect(body.plugins).toEqual([PLUGIN])
    expect(body.marketplaces[0].name).toBe('official')
  })

  it('degrades gracefully when the CLI is missing', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/plugins', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cliFound).toBe(false)
    expect(body.plugins).toEqual([])
    expect(body.marketplaces).toEqual([])
  })

  it('runs allowlisted plugin actions', async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: 'done', stderr: '' }) as CliRunner
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/action',
      headers: auth,
      payload: { action: 'disable', plugin: 'superpowers@claude-plugins-official' },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual([
      'plugin',
      'disable',
      'superpowers@claude-plugins-official',
    ])
  })

  it('rejects unknown actions and flag-like values with 400', async () => {
    const { app } = await fixture({ runner: listRunner() })
    for (const payload of [
      { action: 'nuke', plugin: 'x@y' },
      { action: 'enable', plugin: '--evil' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/plugins/action',
        headers: auth,
        payload,
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('surfaces non-zero exits with the command output', async () => {
    const runner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'claude plugin install x', exitCode: 1, stdout: '', stderr: 'no such plugin' })
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/marketplace',
      headers: auth,
      payload: { action: 'add', value: 'org/repo' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('no such plugin')
  })
})
