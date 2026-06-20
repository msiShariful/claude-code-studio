// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Home } from '../src/views/Home.js'

function stub(payloads: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(payloads).find((k) => url.startsWith(k))
    return Promise.resolve(new Response(JSON.stringify(key ? payloads[key] : {}), { status: 200 }))
  })
}

const EMPTY_SETTINGS = { entries: [], effective: { value: {}, sources: {} } }
const EMPTY_FILES = {
  user: { claudeMd: { path: '/h/CLAUDE.md', exists: false }, agents: [], skills: [] },
}

describe('Home dashboard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows "Set up" prompts when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      stub({
        '/api/settings': EMPTY_SETTINGS,
        '/api/mcp': { servers: [], warnings: [] },
        '/api/files': EMPTY_FILES,
        '/api/plugins': { cliFound: true, plugins: [], marketplaces: [] },
      }),
    )
    render(<Home api={new Api('t')} workspace={{ kind: 'global' }} onOpen={() => {}} />)
    expect(await screen.findByText('Global setup')).toBeDefined()
    // every standard card starts in the "set up" state
    expect(screen.getAllByText('Set up →').length).toBeGreaterThan(0)
    // cards are named after their config file, like the sidebar
    expect(screen.getByText('.mcp.json')).toBeDefined()
    // first-run guidance appears when the workspace is empty
    expect(screen.getByText('A blank slate')).toBeDefined()
  })

  it('summarizes configured pieces with status counts', async () => {
    vi.stubGlobal(
      'fetch',
      stub({
        '/api/settings': {
          entries: [],
          effective: { value: { model: 'opus', hooks: { PostToolUse: [] } }, sources: {} },
        },
        '/api/mcp': {
          servers: [{ name: 'figma', scope: 'user', config: {} }],
          warnings: [],
        },
        '/api/files': EMPTY_FILES,
        '/api/plugins': { cliFound: true, plugins: [], marketplaces: [] },
      }),
    )
    render(<Home api={new Api('t')} workspace={{ kind: 'global' }} onOpen={() => {}} />)
    expect(await screen.findByText('1 server')).toBeDefined()
    expect(screen.getByText('1 event')).toBeDefined()
    expect(screen.getByText('2 keys')).toBeDefined()
    // the configured item names are previewed as chips
    expect(screen.getByText('figma')).toBeDefined()
    // no first-run banner once something is configured
    expect(screen.queryByText('A blank slate')).toBeNull()
  })

  it('opens a section when its card is clicked', async () => {
    const onOpen = vi.fn()
    vi.stubGlobal(
      'fetch',
      stub({
        '/api/settings': EMPTY_SETTINGS,
        '/api/mcp': { servers: [], warnings: [] },
        '/api/files': EMPTY_FILES,
        '/api/plugins': { cliFound: true, plugins: [], marketplaces: [] },
      }),
    )
    render(<Home api={new Api('t')} workspace={{ kind: 'global' }} onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('.mcp.json'))
    expect(onOpen).toHaveBeenCalledWith('tools')
  })
})
