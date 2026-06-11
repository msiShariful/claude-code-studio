import { describe, expect, it } from 'vitest'
import { buildServer } from '../src/server.js'

const TOKEN = 't-test-token'

function makeApp() {
  return buildServer({ token: TOKEN })
}

describe('auth and health', () => {
  it('rejects /api requests without a bearer token', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example.com', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects cross-origin requests', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example.com', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('accepts a same-origin Origin header', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://127.0.0.1:5555', authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts authorized requests and reports health', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.cli.found).toBe('boolean')
  })

  it('serves the placeholder page without auth', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Claude Code Studio')
  })
})
