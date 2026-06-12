// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
      installPath: '/x',
    },
  ],
  marketplaces: [{ name: 'claude-plugins-official', source: 'github', repo: 'a/b', installLocation: '/m' }],
}

describe('Plugins view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders plugins and marketplaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Plugins api={new Api('t')} />)
    expect(await screen.findByText('superpowers@claude-plugins-official')).toBeDefined()
    expect(screen.getByText('claude-plugins-official')).toBeDefined()
    expect(screen.getByText('Disable')).toBeDefined()
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
    render(<Plugins api={new Api('t')} />)
    expect(await screen.findByText(/claude CLI/)).toBeDefined()
  })
})
