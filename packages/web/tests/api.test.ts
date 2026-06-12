// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api, ApiError, bootstrapToken } from '../src/api.js'

function fakeWindow(hash: string) {
  const replaceState = vi.fn()
  return {
    location: { hash, pathname: '/', search: '' },
    sessionStorage: window.sessionStorage,
    history: { replaceState },
    replaceState,
  }
}

describe('bootstrapToken', () => {
  afterEach(() => window.sessionStorage.clear())

  it('reads the token from the fragment, stores it, and strips the hash', () => {
    const win = fakeWindow('#token=abc123')
    const token = bootstrapToken(win)
    expect(token).toBe('abc123')
    expect(window.sessionStorage.getItem('ccs-token')).toBe('abc123')
    expect(win.replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('falls back to sessionStorage when the hash is empty', () => {
    window.sessionStorage.setItem('ccs-token', 'stored')
    expect(bootstrapToken(fakeWindow(''))).toBe('stored')
  })

  it('returns null when no token exists anywhere', () => {
    expect(bootstrapToken(fakeWindow(''))).toBeNull()
  })
})

describe('Api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the bearer token and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new Api('tok')
    const body = await api.health()
    expect(body).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init.headers.authorization).toBe('Bearer tok')
  })

  it('throws ApiError with status and body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'boom', code: 'WRITE_CONFLICT' }), { status: 409 }),
      ),
    )
    const api = new Api('tok')
    const err = await api.health().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).body.code).toBe('WRITE_CONFLICT')
  })
})
