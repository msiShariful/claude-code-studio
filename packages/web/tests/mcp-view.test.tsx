// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Mcp } from '../src/views/Mcp.js'

const LIST = {
  servers: [
    { name: 'figma', scope: 'user', config: { type: 'http', url: 'https://x/mcp' } },
    { name: 'playwright', scope: 'local', config: { type: 'stdio', command: 'npx', args: ['@p/mcp'] } },
  ],
  warnings: [],
}

describe('Mcp view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows only user-scope servers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} workspace={{ kind: 'global' }} />)
    expect(await screen.findByText('figma')).toBeDefined()
    expect(screen.queryByText('playwright')).toBeNull()
  })

  it('project workspace shows only project-side servers and offers local/project scopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    expect(await screen.findByText('playwright')).toBeDefined()
    expect(screen.queryByText('figma')).toBeNull()

    fireEvent.click(screen.getByText('+ Add server'))
    const scopeSelect = screen.getByDisplayValue(/local \(this project, private\)/)
    expect(scopeSelect).toBeDefined()
    expect(screen.queryByText('user (all projects)')).toBeNull()
  })

  it('auto-fills the form when a catalog entry is picked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('figma')

    fireEvent.click(screen.getByText('+ Add server'))
    fireEvent.change(
      screen.getByPlaceholderText('Search catalog (e.g. playwright, github, filesystem)…'),
      { target: { value: 'github' } },
    )
    // Only the GitHub entry matches, so there is a single Use button.
    fireEvent.click(screen.getByText('Use'))

    expect((screen.getByPlaceholderText('server-name') as HTMLInputElement).value).toBe('github')
    expect((screen.getByPlaceholderText('command (e.g. npx)') as HTMLInputElement).value).toBe('npx')
    expect((screen.getByPlaceholderText('args (space separated)') as HTMLInputElement).value).toContain(
      '@modelcontextprotocol/server-github',
    )
    const extra = screen.getByPlaceholderText(
      'extra config JSON, e.g. {"env": {"KEY": "value"}} (optional)',
    ) as HTMLInputElement
    expect(extra.value).toContain('GITHUB_PERSONAL_ACCESS_TOKEN')
    // The token hint is surfaced so the user knows to edit before adding.
    expect(screen.getByText(/Set GITHUB_PERSONAL_ACCESS_TOKEN/)).toBeDefined()
  })

  it('does not let extra config smuggle args past a blank args field', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/mcp/add') {
        return Promise.resolve(new Response(JSON.stringify({ via: 'cli' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Mcp api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('figma')

    fireEvent.click(screen.getByText('+ Add server'))
    fireEvent.change(screen.getByPlaceholderText('server-name'), { target: { value: 'srv' } })
    fireEvent.change(screen.getByPlaceholderText('command (e.g. npx)'), {
      target: { value: 'npx' },
    })
    fireEvent.change(
      screen.getByPlaceholderText('extra config JSON, e.g. {"env": {"KEY": "value"}} (optional)'),
      { target: { value: '{"args": ["--evil"]}' } },
    )
    fireEvent.click(screen.getByText('Add server'))

    await screen.findByText(/Added via the claude CLI/)
    const addCall = fetchMock.mock.calls.find(([u]) => u === '/api/mcp/add')!
    const body = JSON.parse(addCall[1].body)
    expect(body.config.args).toEqual([])
    expect(body.scope).toBe('user')
  })
})
