import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'

const TOKEN = 't-test-token'

async function webRootFixture(): Promise<string> {
  const webRoot = await mkdtemp(join(tmpdir(), 'ccs-web-'))
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>CCS UI</title>')
  await mkdir(join(webRoot, 'assets'), { recursive: true })
  await writeFile(join(webRoot, 'assets', 'app.js'), 'console.log("ui")')
  return webRoot
}

describe('static web serving', () => {
  it('serves index.html at / when webRoot is provided', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CCS UI')
  })

  it('serves asset files', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('falls back to index.html for unknown non-API paths (SPA routes)', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({ url: '/some/client/route' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('CCS UI')
  })

  it('does not fall back for unknown /api paths', async () => {
    const app = buildServer({ token: TOKEN, webRoot: await webRootFixture() })
    const res = await app.inject({
      url: '/api/nope',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('not_found')
  })

  it('keeps the placeholder page when webRoot is absent', async () => {
    const app = buildServer({ token: TOKEN, webRoot: '/definitely/not/a/dir' })
    const res = await app.inject({ url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Claude Code Studio')
  })
})
