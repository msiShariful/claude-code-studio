import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('lists available plugins read from each marketplace manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccs-mkt-'))
    await mkdir(join(dir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(dir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'code-review', description: 'Review PRs' }] }),
    )
    const runner: CliRunner = vi.fn().mockImplementation((_bin: string, args: string[]) => {
      const payload = args.includes('marketplace')
        ? [{ name: 'official', source: 'github', repo: 'a/b', installLocation: dir }]
        : [PLUGIN]
      return Promise.resolve({ command: 'c', exitCode: 0, stdout: JSON.stringify(payload), stderr: '' })
    })
    const { app } = await fixture({ runner })
    const res = await app.inject({ url: '/api/plugins/available', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cliFound).toBe(true)
    expect(body.available).toEqual([
      { installId: 'code-review@official', name: 'code-review', marketplace: 'official', description: 'Review PRs' },
    ])
  })

  it('available plugins degrade to empty when the CLI is missing', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/plugins/available', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ cliFound: false, available: [] })
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

  it('returns the project enablement overrides when a projectDir is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccs-plugin-proj-'))
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }),
    )
    const { app } = await fixture({ runner: listRunner() })
    const res = await app.inject({ url: `/api/plugins?projectDir=${encodeURIComponent(dir)}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().projectEnabled).toEqual({
      'superpowers@claude-plugins-official': false,
    })
  })

  it('rejects a non-absolute projectDir on the list with 400', async () => {
    const { app } = await fixture({ runner: listRunner() })
    const res = await app.inject({ url: '/api/plugins?projectDir=relative/path', headers: auth })
    expect(res.statusCode).toBe(400)
  })

  it('writes a per-project enable straight to the chosen project settings file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccs-plugin-proj-'))
    await mkdir(join(dir, '.claude'), { recursive: true })
    // a CLI that would throw if used — proves the per-project path never touches it
    const runner: CliRunner = vi.fn().mockRejectedValue(new Error('CLI must not be called'))
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/action',
      headers: auth,
      payload: { action: 'enable', plugin: 'superpowers@official', scope: 'project', projectDir: dir },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, scope: 'project' })
    const written = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'))
    expect(written.enabledPlugins).toEqual({ 'superpowers@official': true })
  })

  it('disables a per-project plugin without invoking the CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccs-plugin-proj2-'))
    await mkdir(join(dir, '.claude'), { recursive: true })
    const runner: CliRunner = vi.fn().mockRejectedValue(new Error('CLI must not be called'))
    const { app } = await fixture({ runner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/action',
      headers: auth,
      payload: { action: 'disable', plugin: 'frontend-design@official', scope: 'local', projectDir: dir },
    })
    expect(res.statusCode).toBe(200)
    const written = JSON.parse(await readFile(join(dir, '.claude', 'settings.local.json'), 'utf8'))
    expect(written.enabledPlugins).toEqual({ 'frontend-design@official': false })
  })

  it('rejects a project/local action without an absolute projectDir or with a bad action', async () => {
    const { app } = await fixture({ runner: listRunner() })
    for (const payload of [
      { action: 'enable', plugin: 'x@y', scope: 'local' },
      { action: 'enable', plugin: 'x@y', scope: 'project', projectDir: 'rel/path' },
      { action: 'install', plugin: 'x@y', scope: 'project', projectDir: '/work/app' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/plugins/action', headers: auth, payload })
      expect(res.statusCode).toBe(400)
    }
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
