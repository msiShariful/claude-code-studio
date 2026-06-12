// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Overview } from '../src/views/Overview.js'

const SETTINGS = {
  entries: [
    { scope: 'user', editable: true, state: { path: '/h/.claude/settings.json', exists: true, value: {} } },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

describe('Overview view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows CLI status and never asks for a project directory', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const payload = url.startsWith('/api/health')
        ? { ok: true, cli: { found: true, version: '2.1.0' } }
        : url.startsWith('/api/backups')
          ? { backups: [] }
          : SETTINGS
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Overview api={new Api('t')} />)
    expect(await screen.findByText('2.1.0')).toBeDefined()
    // settings are fetched without a projectDir — this view is global-only
    const settingsCall = fetchMock.mock.calls.find(([u]) => (u as string).startsWith('/api/settings'))!
    expect(settingsCall[0]).toBe('/api/settings')
  })
})
