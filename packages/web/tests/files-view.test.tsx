// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Files } from '../src/views/Files.js'

// CodeMirror needs real layout APIs jsdom lacks; stand in a plain textarea that
// preserves the value/onChange contract so these tests exercise the view, not CM.
vi.mock('../src/components/CodeEditor.js', () => ({
  CodeEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string
    onChange: (next: string) => void
    disabled?: boolean
  }) => (
    <textarea value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  ),
}))

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

  it('the agents view lists user agents and opens one (no tab bar)', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} kind="agent" />)
    // no in-view tabs — the sidebar is the navigation now
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
    fireEvent.click(await screen.findByText('reviewer.md'))
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('creates a new agent from the header control, above the list', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} kind="agent" />)
    await screen.findByText('reviewer.md')
    // the create control lives in the header (reachable without scrolling the list)
    fireEvent.click(screen.getByRole('button', { name: '+ New agent' }))
    fireEvent.change(screen.getByPlaceholderText('new-agent-name'), {
      target: { value: 'planner' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    // the editor opens on the new (unsaved) file
    expect(await screen.findByText(/\(new file\)/)).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('the agents view in a project lists project agents only', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} kind="agent" />)
    expect(await screen.findByText('deployer.md')).toBeDefined()
    expect(screen.queryByText('reviewer.md')).toBeNull()
  })

  it('the memory view auto-opens the editor (no Open button)', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} kind="claudeMd" />)
    // the editor opens straight away with the file content
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Open|Create/ })).toBeNull()
    // single-file views are the editor — no Close
    expect(screen.queryByText('Close')).toBeNull()
  })

  it('the keybindings view auto-opens the editor', async () => {
    vi.stubGlobal('fetch', stub())
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} kind="keybindings" />)
    expect(await screen.findByDisplayValue('# Reviewer')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Open|Create/ })).toBeNull()
  })

  it('asks before discarding unsaved changes when closing the editor', async () => {
    vi.stubGlobal('fetch', stub())
    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<Files api={new Api('t')} workspace={{ kind: 'global' }} kind="agent" />)
    fireEvent.click(await screen.findByText('reviewer.md'))
    const textarea = await screen.findByDisplayValue('# Reviewer')
    fireEvent.change(textarea, { target: { value: '# Edited' } })

    fireEvent.click(screen.getByText('Close'))
    expect(confirmSpy).toHaveBeenCalled()
    // confirm denied → the edit is still open
    expect(screen.getByDisplayValue('# Edited')).toBeDefined()
  })
})
