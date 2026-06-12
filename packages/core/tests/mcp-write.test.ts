import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listBackups } from '../src/backups.js'
import type { CliRunner } from '../src/cli.js'
import { addMcpServer, removeMcpServer } from '../src/mcp.js'
import { mcpFixture } from './fixtures.js'

const okRunner: CliRunner = vi
  .fn()
  .mockResolvedValue({ command: 'claude …', exitCode: 0, stdout: 'ok', stderr: '' })

const missingRunner: CliRunner = () => {
  const err = new Error('spawn claude ENOENT') as Error & { code: string }
  err.code = 'ENOENT'
  return Promise.reject(err)
}

describe('addMcpServer', () => {
  it('shells out to claude mcp add-json when the CLI is available', async () => {
    const { global, projectDir } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: '', stderr: '' }) as CliRunner
    const result = await addMcpServer(
      { name: 'figma', scope: 'project', config: { type: 'http', url: 'https://x' } },
      { global, projectDir, backupsRoot: join(projectDir, 'bak'), runner },
    )
    expect(result.via).toBe('cli')
    expect(vi.mocked(runner).mock.calls[0][0]).toBe('claude')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual([
      'mcp',
      'add-json',
      'figma',
      JSON.stringify({ type: 'http', url: 'https://x' }),
      '-s',
      'project',
    ])
    expect(vi.mocked(runner).mock.calls[0][2]).toMatchObject({ cwd: projectDir })
  })

  it('reports a non-zero CLI exit without falling back', async () => {
    const { global, projectDir } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 1, stdout: '', stderr: 'already exists' }) as CliRunner
    const result = await addMcpServer(
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
      { global, backupsRoot: '/tmp/unused-bak', runner },
    )
    expect(result.via).toBe('cli')
    expect(result.result.exitCode).toBe(1)
    expect(result.result.stderr).toContain('already exists')
  })

  it('falls back to a surgical file edit when the CLI is missing (user scope)', async () => {
    const { global, home } = await mcpFixture()
    await writeFile(global.claudeJson, JSON.stringify({ keepMe: true, mcpServers: {} }))
    const backupsRoot = join(home, 'bak')
    const result = await addMcpServer(
      { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x' } },
      { global, backupsRoot, runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(global.claudeJson, 'utf8'))
    expect(after.keepMe).toBe(true)
    expect(after.mcpServers.figma).toEqual({ type: 'http', url: 'https://x' })
    expect(await listBackups(backupsRoot)).toHaveLength(1)
  })

  it('file fallback writes local scope under projects[projectDir]', async () => {
    const { global, projectDir, home } = await mcpFixture()
    const result = await addMcpServer(
      { name: 'pw', scope: 'local', config: { type: 'stdio', command: 'npx' } },
      { global, projectDir, backupsRoot: join(home, 'bak'), runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(global.claudeJson, 'utf8'))
    expect(after.projects[projectDir].mcpServers.pw).toEqual({ type: 'stdio', command: 'npx' })
  })

  it('rejects invalid names and missing projectDir', async () => {
    const { global } = await mcpFixture()
    const opts = { global, backupsRoot: '/tmp/unused-bak', runner: okRunner }
    await expect(
      addMcpServer({ name: '-evil', scope: 'user', config: {} }, opts),
    ).rejects.toThrow(/name/)
    await expect(
      addMcpServer({ name: '__proto__', scope: 'user', config: {} }, opts),
    ).rejects.toThrow(/name/)
    await expect(
      addMcpServer({ name: 'ok', scope: 'project', config: {} }, opts),
    ).rejects.toThrow(/projectDir/)
  })
})

describe('removeMcpServer', () => {
  it('file fallback deletes from .mcp.json (project scope)', async () => {
    const { global, projectDir, home } = await mcpFixture()
    const mcpJson = join(projectDir, '.mcp.json')
    await writeFile(
      mcpJson,
      JSON.stringify({ mcpServers: { a: { type: 'http', url: 'u' }, b: { type: 'http', url: 'v' } } }),
    )
    const result = await removeMcpServer(
      { name: 'a', scope: 'project' },
      { global, projectDir, backupsRoot: join(home, 'bak'), runner: missingRunner },
    )
    expect(result.via).toBe('file')
    const after = JSON.parse(await readFile(mcpJson, 'utf8'))
    expect(after.mcpServers).toEqual({ b: { type: 'http', url: 'v' } })
  })

  it('uses claude mcp remove when the CLI is available', async () => {
    const { global } = await mcpFixture()
    const runner = vi
      .fn()
      .mockResolvedValue({ command: 'c', exitCode: 0, stdout: '', stderr: '' }) as CliRunner
    const result = await removeMcpServer(
      { name: 'figma', scope: 'user' },
      { global, backupsRoot: '/tmp/unused-bak', runner },
    )
    expect(result.via).toBe('cli')
    expect(vi.mocked(runner).mock.calls[0][1]).toEqual(['mcp', 'remove', 'figma', '-s', 'user'])
  })
})
