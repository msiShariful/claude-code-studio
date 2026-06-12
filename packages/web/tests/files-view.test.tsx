// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Files } from '../src/views/Files.js'

const LISTING = {
  user: {
    claudeMd: { path: '/h/.claude/CLAUDE.md', exists: true },
    keybindings: { path: '/h/.claude/keybindings.json', exists: false },
    agents: [{ name: 'reviewer.md', path: '/h/.claude/agents/reviewer.md' }],
    skills: [],
  },
}

const READ = { path: '/h/.claude/agents/reviewer.md', exists: true, content: '# Reviewer', hash: 'abc' }

describe('Files view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('lists agents and opens one in the editor pane', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const payload = url.startsWith('/api/files/read') ? READ : LISTING
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )
    render(<Files api={new Api('t')} projectDir="" />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('asks before discarding unsaved changes on tab switch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const payload = url.startsWith('/api/files/read') ? READ : LISTING
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<Files api={new Api('t')} projectDir="" />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    const textarea = await screen.findByDisplayValue('# Reviewer')
    fireEvent.change(textarea, { target: { value: '# Edited' } })

    fireEvent.click(screen.getByText('Skills'))
    expect(confirmSpy).toHaveBeenCalled()
    // declined: still on the open file
    expect(screen.getByDisplayValue('# Edited')).toBeDefined()
  })
})
