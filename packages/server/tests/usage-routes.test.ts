import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auth, fixture } from './helpers.js'

const SONNET = 'claude-sonnet-4-6'

function assistantLine(ts: string, model: string, input: number, reqId: string) {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      requestId: reqId,
      message: { model, id: reqId, usage: { input_tokens: input } },
    }) + '\n'
  )
}

/** Seed a JSONL transcript under the fixture HOME's ~/.claude/projects. */
async function seed(configDir: string) {
  const sessionDir = join(configDir, 'projects', 'proj-demo')
  await mkdir(sessionDir, { recursive: true })
  await writeFile(
    join(sessionDir, 'sess.jsonl'),
    assistantLine('2026-06-02T10:00:00Z', SONNET, 1_000_000, 'r1'),
  )
}

describe('usage routes', () => {
  let app: Awaited<ReturnType<typeof fixture>>['app'] | undefined
  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('requires the bearer token', async () => {
    const f = await fixture()
    app = f.app
    const res = await app.inject({ method: 'GET', url: '/api/usage/overview' })
    expect(res.statusCode).toBe(401)
  })

  it('serves an overview computed from the JSONL transcripts', async () => {
    const f = await fixture()
    app = f.app
    await seed(f.globalPaths.configDir)

    const res = await app.inject({ method: 'GET', url: '/api/usage/overview', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.stats.cost).toBeCloseTo(3.0) // 1M sonnet input tokens
    expect(body.stats.session_count).toBe(1)
    expect(Array.isArray(body.heatmap)).toBe(true)
  })

  it('passes query options through to the engine (models period filter)', async () => {
    const f = await fixture()
    app = f.app
    await seed(f.globalPaths.configDir)

    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/models?period=today',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    // The seeded turn is dated 2026-06-02, not "today", so the period filter empties it.
    expect(res.json().models).toEqual([])
  })

  it('returns an empty, well-formed payload when no logs exist', async () => {
    const f = await fixture()
    app = f.app
    const res = await app.inject({ method: 'GET', url: '/api/usage/stats', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ cost: 0, session_count: 0, project_count: 0 })
  })
})
