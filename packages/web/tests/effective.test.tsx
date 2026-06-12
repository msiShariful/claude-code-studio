// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Effective } from '../src/views/Effective.js'

const SETTINGS = {
  entries: [],
  effective: {
    value: { model: 'sonnet', env: { FOO: '1' } },
    sources: { model: 'projectLocal', 'env.FOO': 'user' },
  },
}

describe('Effective view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders one row per leaf with its scope badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
    )
    render(<Effective api={new Api('t')} projectDir="" />)
    expect(await screen.findByText('model')).toBeDefined()
    expect(screen.getByText('env.FOO')).toBeDefined()
    expect(screen.getByText('projectLocal')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
  })
})
