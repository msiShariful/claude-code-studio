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

  it('lists servers with scope badges and previews the add form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(LIST), { status: 200 })),
    )
    render(<Mcp api={new Api('t')} projectDir="/work/app" />)
    expect(await screen.findByText('figma')).toBeDefined()
    expect(screen.getByText('playwright')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
    expect(screen.getByText('local')).toBeDefined()
    expect(screen.getByText('https://x/mcp')).toBeDefined()

    fireEvent.click(screen.getByText('+ Add server'))
    expect(screen.getByPlaceholderText('server-name')).toBeDefined()
  })

  it('does not let extra config smuggle args past a blank args field', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/mcp/add') {
        return Promise.resolve(new Response(JSON.stringify({ via: 'cli' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<Mcp api={new Api('t')} projectDir="" />)
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
  })
})
