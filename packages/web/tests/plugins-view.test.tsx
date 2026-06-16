// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Plugins } from '../src/views/Plugins.js'

const LIST = {
  cliFound: true,
  plugins: [
    {
      id: 'superpowers@claude-plugins-official',
      version: '5.1.0',
      scope: 'user',
      enabled: true,
      installPath: '/Users/sharif/.claude/plugins/cache/superpowers/5.1.0',
      installedAt: '2026-05-03T17:07:48.917Z',
      lastUpdated: '2026-05-03T17:07:48.917Z',
    },
  ],
  marketplaces: [{ name: 'claude-plugins-official', source: 'github', repo: 'a/b', installLocation: '/m' }],
}

describe('Plugins view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('splits the plugin name from its marketplace and shows status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    const installed = await screen.findByRole('region', { name: 'Installed plugins' })
    // the @marketplace suffix is stripped from the prominent name
    expect(within(installed).getByRole('button', { name: /superpowers/ })).toBeDefined()
    expect(within(installed).getByText('enabled')).toBeDefined()
    expect(within(installed).getByText('Disable')).toBeDefined()
    // the marketplace name appears in the Marketplaces section table
    const marketplaces = screen.getByRole('region', { name: 'Marketplaces' })
    expect(within(marketplaces).getByText('claude-plugins-official')).toBeDefined()
  })

  it('expands a plugin row to reveal install details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    const installed = await screen.findByRole('region', { name: 'Installed plugins' })
    // details are hidden until the row is expanded
    expect(within(installed).queryByText('Install path')).toBeNull()
    fireEvent.click(within(installed).getByRole('button', { name: /superpowers/ }))
    expect(within(installed).getByText('Install path')).toBeDefined()
    expect(
      within(installed).getByText('/Users/sharif/.claude/plugins/cache/superpowers/5.1.0'),
    ).toBeDefined()
    // the ISO timestamp is shown in a readable form (installed + last updated)
    expect(within(installed).getAllByText(/2026-05-03 17:07 UTC/).length).toBeGreaterThan(0)
  })

  it('reveals the catalog from the Add marketplace toggle and prefills the source on Use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    // catalog is hidden until the add panel is opened
    expect(screen.queryByPlaceholderText('Search marketplaces (e.g. superpowers, templates)…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add marketplace' }))
    fireEvent.change(
      screen.getByPlaceholderText('Search marketplaces (e.g. superpowers, templates)…'),
      { target: { value: 'templates' } },
    )
    fireEvent.click(screen.getByText('Use'))
    expect(
      (screen.getByPlaceholderText('github org/repo, URL, or local path') as HTMLInputElement)
        .value,
    ).toBe('davila7/claude-code-templates')
  })

  it('reveals the install field from the Install plugin toggle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    expect(screen.queryByPlaceholderText('plugin or plugin@marketplace')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Install plugin' }))
    expect(screen.getByPlaceholderText('plugin or plugin@marketplace')).toBeDefined()
  })

  it('shows an in-progress label and a hint while adding a marketplace', async () => {
    let resolveAdd: (r: Response) => void = () => {}
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/api/plugins/marketplace')) {
        return new Promise<Response>((res) => {
          resolveAdd = res
        })
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add marketplace' }))
    fireEvent.change(screen.getByPlaceholderText('github org/repo, URL, or local path'), {
      target: { value: 'msishariful/claude-tools' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add marketplace' }))
    // the request is in flight: the button reflects progress and a hint explains the wait
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDefined()
    expect(screen.getByText(/can take a moment/i)).toBeDefined()
    resolveAdd(new Response(JSON.stringify({ ok: true, output: '' }), { status: 200 }))
  })

  it('confirms uninstall with an in-app dialog instead of window.confirm', async () => {
    const actionBodies: string[] = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/plugins/action')) {
        actionBodies.push(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({ ok: true, output: '' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    const installed = await screen.findByRole('region', { name: 'Installed plugins' })
    fireEvent.click(within(installed).getByRole('button', { name: 'Uninstall' }))
    // a modal appears and nothing is uninstalled yet
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Uninstall superpowers@claude-plugins-official/)).toBeDefined()
    expect(actionBodies.length).toBe(0)
    // cancelling closes the dialog without acting
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(actionBodies.length).toBe(0)
    // confirming runs the uninstall
    fireEvent.click(within(installed).getByRole('button', { name: 'Uninstall' }))
    const dialog2 = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Uninstall' }))
    await screen.findByText(/Uninstalled/)
    expect(actionBodies.some((b) => b.includes('uninstall'))).toBe(true)
  })

  const TWO_SCOPES = {
    cliFound: true,
    plugins: [
      { id: 'superpowers@official', version: '5.1.0', scope: 'user', enabled: true, installPath: '/u' },
      {
        id: 'token-inspector@shariful',
        version: '1.0.0',
        scope: 'local',
        enabled: false,
        installPath: '/p',
        projectPath: '/work/app',
      },
    ],
    marketplaces: [{ name: 'official', source: 'github', repo: 'a/b', installLocation: '/m' }],
  }

  it('User scope lists only user-scope plugins and keeps the marketplaces section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(TWO_SCOPES), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'user' }} />)
    const installed = await screen.findByRole('region', { name: 'Installed plugins' })
    expect(within(installed).getByRole('button', { name: /superpowers/ })).toBeDefined()
    expect(within(installed).queryByRole('button', { name: /token-inspector/ })).toBeNull()
    // marketplaces are a user/global concern, so they remain visible here
    expect(screen.getByRole('region', { name: 'Marketplaces' })).toBeDefined()
  })

  it('Project scope shows only that project’s plugins and hides marketplaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(TWO_SCOPES), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    const installed = await screen.findByRole('region', { name: 'Installed plugins' })
    expect(within(installed).getByRole('button', { name: /token-inspector/ })).toBeDefined()
    expect(within(installed).queryByRole('button', { name: /superpowers/ })).toBeNull()
    // no user-scope machinery: marketplaces section and install toggle are gone
    expect(screen.queryByRole('region', { name: 'Marketplaces' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Install plugin' })).toBeNull()
  })

  it('shows the degraded notice when the CLI is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ cliFound: false, plugins: [], marketplaces: [] }), {
          status: 200,
        }),
      ),
    )
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    expect(await screen.findByText(/claude CLI/)).toBeDefined()
  })
})
