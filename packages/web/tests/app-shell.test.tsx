// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import { encodeProjectId } from '../src/workspace.js'

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
      state: {
        path: '/work/app/.claude/settings.json',
        exists: true,
        raw: '{"model": "opus"}',
        value: { model: 'opus' },
      },
    },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

const FILES = {
  user: { claudeMd: { path: '/h/CLAUDE.md', exists: false }, agents: [], skills: [] },
  project: { claudeMd: { path: '/work/app/CLAUDE.md', exists: false }, agents: [], skills: [] },
}

const EXTRA_PROJECT = { dir: '/somewhere/new', name: 'new', exists: true }

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    let payload: unknown
    if (url.startsWith('/api/projects')) {
      payload = url.includes('extra=')
        ? { projects: [...PROJECTS.projects, EXTRA_PROJECT] }
        : PROJECTS
    } else if (url.startsWith('/api/health')) {
      payload = { ok: true, cli: { found: true, version: '2.1.0' } }
    } else if (url.startsWith('/api/backups')) {
      payload = { backups: [] }
    } else if (url.startsWith('/api/mcp')) {
      payload = { servers: [], warnings: [] }
    } else if (url.startsWith('/api/files')) {
      payload = FILES
    } else if (url.startsWith('/api/plugins')) {
      payload = { cliFound: true, plugins: [], marketplaces: [] }
    } else {
      payload = SETTINGS
    }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

const APP_ID = encodeProjectId('/work/app')

describe('App shell', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('lands on the global Home with the section nav', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    // plain-language section labels, not jargon
    expect(within(nav).getByText('Permissions & Behavior')).toBeDefined()
    expect(within(nav).getByText('Tools & Integrations')).toBeDefined()
    // global Home dashboard
    expect(await screen.findByText('Global setup')).toBeDefined()
    expect(window.location.pathname).toBe('/global')
  })

  it('navigates between sections and reflects it in the URL and breadcrumb', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(nav).getByText('Tools & Integrations'))
    expect(await screen.findByRole('heading', { name: 'MCP servers' })).toBeDefined()
    expect(window.location.pathname).toBe('/global/tools')
  })

  it('switches to a project from the workspace switcher and updates the URL', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(screen.getByLabelText('Switch workspace'))
    fireEvent.click(await screen.findByText('app'))
    expect(await screen.findByText('Project setup')).toBeDefined()
    expect(window.location.pathname).toBe(`/project/${APP_ID}`)
  })

  it('disables projects whose directory is missing', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(screen.getByLabelText('Switch workspace'))
    const missing = (await screen.findByText('old')).closest('button')!
    expect(missing.disabled).toBe(true)
    expect(screen.getByText('missing')).toBeDefined()
  })

  it('deep-links: a project section URL renders directly on load (reload-safe)', async () => {
    window.history.pushState({}, '', `/project/${APP_ID}/tools`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    expect(await screen.findByRole('heading', { name: 'MCP servers' })).toBeDefined()
  })

  it('restores the last-used route when opened at the bare URL', async () => {
    window.localStorage.setItem('ccs-last-route', `/project/${APP_ID}/effective`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    expect(await screen.findByText('Effective settings')).toBeDefined()
    expect(window.location.pathname).toBe(`/project/${APP_ID}/effective`)
  })

  it('adds a project by path and remembers it as an extra', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    await screen.findByText('Global setup')
    fireEvent.click(screen.getByLabelText('Switch workspace'))
    fireEvent.change(screen.getByPlaceholderText('/path/to/project'), {
      target: { value: '/somewhere/new' },
    })
    fireEvent.click(screen.getByText('+ Add project'))
    expect(window.localStorage.getItem('ccs-extra-projects')).toContain('/somewhere/new')
    expect(await screen.findByText('Project setup')).toBeDefined()
  })

  it('removing the active extra project returns to Global', async () => {
    const id = encodeProjectId('/somewhere/new')
    window.localStorage.setItem('ccs-extra-projects', JSON.stringify(['/somewhere/new']))
    window.history.pushState({}, '', `/project/${id}`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(screen.getByLabelText('Switch workspace'))
    fireEvent.click(await screen.findByTitle('Remove from list'))
    expect(window.localStorage.getItem('ccs-extra-projects')).not.toContain('/somewhere/new')
    expect(await screen.findByText('Global setup')).toBeDefined()
  })

  it('clicking a user-sourced value in Effective jumps to Global settings', async () => {
    window.history.pushState({}, '', `/project/${APP_ID}/effective`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('model'))
    expect(await screen.findByDisplayValue('model')).toBeDefined()
    expect(window.location.pathname).toBe('/global/settings')
  })
})
