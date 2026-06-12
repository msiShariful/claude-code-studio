import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { CliRunner } from '@claude-code-studio/core'
import { auth, fixture } from './helpers.js'

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
}

describe('/api/mcp', () => {
  it('lists servers with cli availability', async () => {
    const { app, globalPaths } = await fixture({ runner: missingRunner })
    await writeFile(
      globalPaths.claudeJson,
      JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://x' } } }),
    )
    const res = await app.inject({ url: '/api/mcp', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.servers).toEqual([
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
    ])
  })

  it('adds a server (file fallback path) and removes it again', async () => {
    const { app, globalPaths } = await fixture({ runner: missingRunner })
    const add = await app.inject({
      method: 'POST',
      url: '/api/mcp/add',
      headers: auth,
      payload: { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
    })
    expect(add.statusCode).toBe(200)
    expect(add.json().via).toBe('file')
    expect(JSON.parse(await readFile(globalPaths.claudeJson, 'utf8')).mcpServers.figma).toBeTruthy()

    const remove = await app.inject({
      method: 'POST',
      url: '/api/mcp/remove',
      headers: auth,
      payload: { name: 'figma', scope: 'user' },
    })
    expect(remove.statusCode).toBe(200)
    expect(JSON.parse(await readFile(globalPaths.claudeJson, 'utf8')).mcpServers).toEqual({})
  })

  it('surfaces non-zero CLI exits as 400 with the command output', async () => {
    const cliRunner: CliRunner = vi
      .fn()
      .mockResolvedValue({ command: 'claude mcp …', exitCode: 1, stdout: '', stderr: 'nope' })
    const { app } = await fixture({ runner: cliRunner })
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp/add',
      headers: auth,
      payload: { name: 'x', scope: 'user', config: { type: 'stdio', command: 'y' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('nope')
  })

  it('rejects bad names, scopes, configs, and relative projectDir', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const cases = [
      { name: '-evil', scope: 'user', config: {} },
      { name: 'ok', scope: 'global', config: {} },
      { name: 'ok', scope: 'user', config: 'not-an-object' },
      { name: 'ok', scope: 'project', config: {}, projectDir: 'relative/path' },
    ]
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/mcp/add', headers: auth, payload })
      expect(res.statusCode).toBe(400)
    }
  })

  it('requires auth', async () => {
    const { app } = await fixture({ runner: missingRunner })
    const res = await app.inject({ url: '/api/mcp' })
    expect(res.statusCode).toBe(401)
  })
})
