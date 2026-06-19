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

  it('reveals the catalog and adds a marketplace directly from its row', async () => {
    const actionBodies: string[] = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/plugins/marketplace')) {
        actionBodies.push(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({ ok: true, output: '' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    // catalog is hidden until the add panel is opened
    expect(screen.queryByPlaceholderText('Search marketplaces (e.g. superpowers, templates)…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add marketplace' }))
    fireEvent.change(
      screen.getByPlaceholderText('Search marketplaces (e.g. superpowers, templates)…'),
      { target: { value: 'templates' } },
    )
    // the catalog row's own Add button adds it directly — no Use step
    const list = screen.getByRole('list')
    fireEvent.click(within(list).getByRole('button', { name: 'Add' }))
    await screen.findByText(/Added marketplace/)
    expect(
      actionBodies.some((b) => b.includes('davila7/claude-code-templates') && b.includes('add')),
    ).toBe(true)
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

  const AVAILABLE = {
    cliFound: true,
    available: [
      { installId: 'code-review@official', name: 'code-review', marketplace: 'official', description: 'Automated code review', category: 'development' },
      { installId: 'superpowers@official', name: 'superpowers', marketplace: 'official', description: 'Workflow skills' },
    ],
  }

  it('installs a searched plugin directly from its suggestion row', async () => {
    const actionBodies: string[] = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/plugins/available')) {
        return Promise.resolve(new Response(JSON.stringify(AVAILABLE), { status: 200 }))
      }
      if (typeof url === 'string' && url.includes('/api/plugins/action')) {
        actionBodies.push(String(init?.body))
        return Promise.resolve(new Response(JSON.stringify({ ok: true, output: '' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    fireEvent.click(screen.getByRole('button', { name: '+ Install plugin' }))

    const search = await screen.findByPlaceholderText('Search plugins to install…')
    expect(await screen.findByText('code-review')).toBeDefined()
    fireEvent.change(search, { target: { value: 'superpowers' } })
    // the suggestion list now holds only the superpowers row
    const list = screen.getByRole('list')
    expect(within(list).queryByText('code-review')).toBeNull()
    // its own Install button installs it directly — no Use step
    fireEvent.click(within(list).getByRole('button', { name: 'Install' }))
    await screen.findByText(/Installed superpowers@official/)
    expect(actionBodies.some((b) => b.includes('superpowers@official') && b.includes('install'))).toBe(true)
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

  it('Project scope offers a button that jumps to the User scope to install plugins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(TWO_SCOPES), { status: 200 })),
    )
    const onInstallElsewhere = vi.fn()
    render(
      <Plugins
        api={new Api('t')}
        workspace={{ kind: 'project', dir: '/work/app' }}
        onInstallElsewhere={onInstallElsewhere}
      />,
    )
    await screen.findByRole('region', { name: 'Installed plugins' })
    fireEvent.click(screen.getByRole('button', { name: /Install in User scope/ }))
    expect(onInstallElsewhere).toHaveBeenCalledTimes(1)
  })

  it('Project scope with no plugins still offers a way to install them', async () => {
    const EMPTY = { cliFound: true, plugins: [], marketplaces: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(EMPTY), { status: 200 })),
    )
    const onInstallElsewhere = vi.fn()
    render(
      <Plugins
        api={new Api('t')}
        workspace={{ kind: 'project', dir: '/work/app' }}
        onInstallElsewhere={onInstallElsewhere}
      />,
    )
    await screen.findByText('No plugins installed')
    // the empty project no longer dead-ends: the install affordance is present
    fireEvent.click(screen.getByRole('button', { name: /Install in User scope/ }))
    expect(onInstallElsewhere).toHaveBeenCalledTimes(1)
  })

  it('surfaces action results in a dismissible toast instead of a top banner', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/api/plugins/marketplace')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Marketplace file not found' }), { status: 400 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Plugins api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByRole('region', { name: 'Installed plugins' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add marketplace' }))
    fireEvent.change(screen.getByPlaceholderText('github org/repo, URL, or local path'), {
      target: { value: 'davila7/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add marketplace' }))
    // the result lands in a floating toast (role=status), not the document flow
    const toast = await screen.findByRole('status')
    expect(within(toast).getByText(/Marketplace file not found/)).toBeDefined()
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
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
