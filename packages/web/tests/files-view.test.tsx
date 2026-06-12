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
  project: {
    claudeMd: { path: '/work/app/CLAUDE.md', exists: false },
    agents: [{ name: 'deployer.md', path: '/work/app/.claude/agents/deployer.md' }],
    skills: [],
  },
}

const READ = { path: '/h/.claude/agents/reviewer.md', exists: true, content: '# Reviewer', hash: 'abc' }

function stub() {
  return vi.fn().mockImplementation((url: string) => {
    const payload = url.startsWith('/api/files/read') ? READ : LISTING
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

describe('Files view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace lists user agents and opens one', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
    // keybindings is a global-only tab
    expect(screen.getByText('Keybindings')).toBeDefined()
  })

  it('project workspace lists project agents and hides keybindings', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    expect(await screen.findByText('deployer.md')).toBeDefined()
    expect(screen.queryByText('reviewer.md')).toBeNull()
    expect(screen.queryByText('Keybindings')).toBeNull()
  })

  it('asks before discarding unsaved changes on tab switch', async () => {
    vi.stubGlobal('fetch', stub())
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} />)
    fireEvent.click(await screen.findByText('Agents'))
    fireEvent.click(await screen.findByText('reviewer.md'))
    const textarea = await screen.findByDisplayValue('# Reviewer')
    fireEvent.change(textarea, { target: { value: '# Edited' } })

    fireEvent.click(screen.getByText('Skills'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByDisplayValue('# Edited')).toBeDefined()
  })
})
