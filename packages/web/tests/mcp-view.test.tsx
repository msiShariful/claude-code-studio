// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
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
  afterEach(() => vi.unstubAllGlobals())

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
})
