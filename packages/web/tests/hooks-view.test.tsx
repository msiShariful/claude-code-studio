// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Hooks } from '../src/views/Hooks.js'

// The managed read-only preview uses the CodeMirror viewer, which needs layout
// APIs jsdom lacks; stand in a <pre> showing the raw text.
vi.mock('../src/components/CodeEditor.js', () => ({
  CodeEditor: ({ value }: { value: string }) => <pre className="code">{value}</pre>,
}))

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: {
        path: '/h/.claude/settings.json',
        exists: true,
        hash: 'h1',
        value: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      },
    },
    {
      scope: 'project',
      editable: true,
      state: {
        path: '/work/app/.claude/settings.json',
        exists: true,
        hash: 'h2',
        value: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } },
      },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: {}, sources: {} },
}

const PREVIEW = {
  filePath: '/h/.claude/settings.json',
  before: '{}',
  after: '{ "hooks": {} }',
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n+added a hook',
  expectedHash: 'h1',
  nextValue: {},
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/settings/preview')) {
      return Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    }
    if (url.startsWith('/api/settings/apply')) {
      return Promise.resolve(new Response(JSON.stringify({ applied: true, diff: '' }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(SETTINGS), { status: 200 }))
  })
}

/** The add form / buttons for one event, scoped to that event's card. */
function card(event: string) {
  const head = screen.getByText(event)
  return within(head.closest('.card') as HTMLElement)
}

describe('Hooks view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows user hooks as readable rows and offers a raw escape hatch', async () => {
    vi.stubGlobal('fetch', stubFetch())
    const onEdit = vi.fn()
    render(<Hooks api={new Api('t')} workspace={{ kind: 'global' }} onEdit={onEdit} />)

    expect(await screen.findByText('echo hi')).toBeDefined()
    expect(screen.getByText('Bash')).toBeDefined() // the matcher chip
    expect(screen.queryByText('say done')).toBeNull() // project hook must not leak

    fireEvent.click(card('PreToolUse').getByText('Edit raw'))
    expect(onEdit).toHaveBeenCalledWith('user', 'hooks.PreToolUse')
  })

  it('project workspace shows project hooks only', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Hooks api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)

    expect(await screen.findByText('say done')).toBeDefined()
    expect(screen.queryByText('echo hi')).toBeNull()
  })

  it('adds a hook through the form and previews then applies it', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<Hooks api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('echo hi')

    const ups = () => card('UserPromptSubmit')
    fireEvent.click(ups().getByText('+ Add hook'))
    fireEvent.change(ups().getByLabelText('Command for UserPromptSubmit'), {
      target: { value: './guard.sh' },
    })
    fireEvent.click(ups().getByText('Add hook'))

    expect(screen.getByText('./guard.sh')).toBeDefined()
    expect(screen.getByText('1 change')).toBeDefined()

    await act(async () => {
      fireEvent.click(screen.getByText('Preview diff'))
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('Apply changes'))
    })

    const applyCall = fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/api/settings/apply'))
    const body = JSON.parse((applyCall![1] as RequestInit).body as string)
    expect(body.edits).toContainEqual({
      path: 'hooks.UserPromptSubmit',
      value: [{ hooks: [{ type: 'command', command: './guard.sh' }] }],
    })
  })

  it('removes a hook after confirmation', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Hooks api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('echo hi')

    fireEvent.click(screen.getByLabelText('Remove PreToolUse hook'))
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    })

    expect(screen.queryByText('echo hi')).toBeNull()
    expect(screen.getByText('1 change')).toBeDefined()
  })
})
