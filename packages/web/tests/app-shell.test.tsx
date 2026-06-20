// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('lands on the global Home with the file-tree nav', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    // the nav is the real .claude/ tree — filenames, with .claude/ open by default
    expect(within(nav).getByText('settings.json')).toBeDefined()
    expect(within(nav).getByText('.mcp.json')).toBeDefined()
    // global Home dashboard
    expect(await screen.findByText('Global setup')).toBeDefined()
    expect(window.location.pathname).toBe('/global')
  })

  it('navigates between sections and reflects it in the URL and breadcrumb', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(nav).getByText('.mcp.json'))
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

  it('clicking a user-sourced value in Effective jumps to User settings', async () => {
    window.history.pushState({}, '', `/project/${APP_ID}/effective`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    fireEvent.click(await screen.findByText('model'))
    expect(await screen.findByDisplayValue('model')).toBeDefined()
    expect(window.location.pathname).toBe('/user/settings')
  })

  it('mirrors the Settings tab in the sidebar highlight (tab → tree)', async () => {
    window.history.pushState({}, '', `/project/${APP_ID}/settings`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const row = (label: string) => within(nav).getByText(label).closest('button')!
    // default project tab → settings.json glows
    await screen.findByRole('button', { name: 'projectLocal' })
    await waitFor(() => expect(row('settings.json').className).toContain('active'))
    // clicking the projectLocal tab moves the highlight to settings.local.json
    fireEvent.click(screen.getByRole('button', { name: 'projectLocal' }))
    await waitFor(() => expect(row('settings.local.json').className).toContain('active'))
    expect(row('settings.json').className).not.toContain('active')
  })

  it('routes file nodes to their own sections, each with only that content', async () => {
    window.history.pushState({}, '', `/project/${APP_ID}`)
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const treeRow = (label: string) => within(nav).getByText(label).closest('button')!

    // agents/ opens the Agents view (no in-view tab bar) and lights its own row
    fireEvent.click(within(nav).getByText('agents/'))
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeDefined()
    expect(window.location.pathname).toBe(`/project/${APP_ID}/agents`)
    expect(treeRow('agents/').className).toContain('active')
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()

    // skills/ is a separate section with its own URL and content
    fireEvent.click(within(nav).getByText('skills/'))
    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeDefined()
    expect(window.location.pathname).toBe(`/project/${APP_ID}/skills`)
    await waitFor(() => expect(treeRow('skills/').className).toContain('active'))
    expect(treeRow('agents/').className).not.toContain('active')
  })

  it('switches to the User scope from the workspace switcher', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<App token="t" />)
    await screen.findByText('Global setup')
    fireEvent.click(screen.getByLabelText('Switch workspace'))
    fireEvent.click(await screen.findByText('User'))
    expect(await screen.findByText('User setup')).toBeDefined()
    expect(window.location.pathname).toBe('/user')
  })
})
