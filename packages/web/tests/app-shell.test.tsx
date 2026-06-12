// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

const PROJECTS = {
  projects: [
    { dir: '/work/app', name: 'app', exists: true },
    { dir: '/gone/old', name: 'old', exists: false },
  ],
}

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/h/.claude/settings.json', exists: true, raw: '{}', value: {} },
    },
    {
      scope: 'project',
      editable: true,
      state: { path: '/work/app/.claude/settings.json', exists: true, raw: '{"model": "opus"}', value: { model: 'opus' } },
    },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    const payload = url.startsWith('/api/projects')
      ? PROJECTS
      : url.startsWith('/api/health')
        ? { ok: true, cli: { found: true, version: '2.1.0' } }
        : url.startsWith('/api/backups')
          ? { backups: [] }
          : url.startsWith('/api/mcp')
            ? { servers: [], warnings: [] }
            : SETTINGS
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

describe('App shell', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('renders Global and Projects groups with known projects', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    // 'Global' appears in both the nav group title and the breadcrumb
    expect(screen.getAllByText('Global').length).toBeGreaterThan(0)
    expect(screen.getByText('Projects')).toBeDefined()
    expect(await screen.findByText('app')).toBeDefined()
    expect(screen.getByText('old')).toBeDefined()
    // global landing view
    expect(await screen.findByText('Overview', { selector: 'button' })).toBeDefined()
  })

  it('entering a project expands its sub-nav and lands on Effective', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('app'))
    // 'Effective' appears in both the sub-nav and the breadcrumb
    expect((await screen.findAllByText('Effective')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Effective settings')).toBeDefined()
    // persisted
    expect(window.localStorage.getItem('ccs-workspace')).toContain('/work/app')
  })

  it('disables projects whose directory is missing', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const missing = (await screen.findByText('old')).closest('button')!
    expect(missing.disabled).toBe(true)
    expect(screen.getByText('missing')).toBeDefined()
  })

  it('restores the persisted workspace on load', async () => {
    window.localStorage.setItem('ccs-workspace', JSON.stringify({ kind: 'project', dir: '/work/app' }))
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    expect(await screen.findByText('Effective settings')).toBeDefined()
  })

  it('adds a project by path and remembers it as an extra', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    await screen.findByText('app')
    fireEvent.change(screen.getByPlaceholderText('/path/to/project'), {
      target: { value: '/somewhere/new' },
    })
    fireEvent.click(screen.getByText('+ Add project'))
    expect(window.localStorage.getItem('ccs-extra-projects')).toContain('/somewhere/new')
    expect(await screen.findByText('Effective settings')).toBeDefined()
  })

  it('clicking a user-sourced value in Effective jumps to Global settings', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('app'))
    // Effective table: the model row is sourced from the user scope
    fireEvent.click(await screen.findByText('model'))
    expect(await screen.findByDisplayValue('model')).toBeDefined()
    // crumb shows the global workspace
    expect(screen.getAllByText('Global').length).toBeGreaterThan(1)
  })
})
