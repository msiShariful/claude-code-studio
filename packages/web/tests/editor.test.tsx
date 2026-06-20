// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Editor } from '../src/views/Editor.js'

// The read-only settings viewer is CodeMirror, which needs layout APIs jsdom lacks.
// Stand in a <pre> that shows the raw text so these tests can assert on file contents.
vi.mock('../src/components/CodeEditor.js', () => ({
  CodeEditor: ({ value }: { value: string }) => <pre className="code">{value}</pre>,
}))

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/home/u/.claude/settings.json', exists: true, raw: '{"model": "opus"}' },
    },
    {
      scope: 'managed',
      editable: false,
      state: { path: '/etc/m.json', exists: true, raw: '{"locked": true}' },
    },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

const PROJECT_SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/home/u/.claude/settings.json', exists: true, raw: '{"model": "opus"}' },
    },
    {
      scope: 'project',
      editable: true,
      state: { path: '/work/app/.claude/settings.json', exists: true, raw: '{"model": "sonnet"}' },
    },
    {
      scope: 'projectLocal',
      editable: true,
      state: { path: '/work/app/.claude/settings.local.json', exists: false },
    },
  ],
  effective: { value: { model: 'sonnet' }, sources: { model: 'project' } },
}

const PREVIEW = {
  filePath: '/home/u/.claude/settings.json',
  before: '{"model": "opus"}',
  after: '{\n  "model": "sonnet"\n}\n',
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n-{"model": "opus"}\n+  "model": "sonnet"',
  expectedHash: 'abc',
  nextValue: { model: 'sonnet' },
}

function stubFetch(settings: unknown = SETTINGS) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/settings/preview')) {
      return Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(settings), { status: 200 }))
  })
}

describe('Editor view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows the user file and previews a diff', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    expect(await screen.findByText('{"model": "opus"}')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('model or env.FOO'), {
      target: { value: 'model' },
    })
    fireEvent.change(screen.getByPlaceholderText('"sonnet" or {"a": 1} or plain text'), {
      target: { value: '"sonnet"' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Preview diff'))
    })

    expect(await screen.findByText('+  "model": "sonnet"', { normalizer: (s) => s })).toBeDefined()
    expect(screen.getByText('Apply change')).toBeDefined()
  })

  it('discards a previewed diff when an edit row is deleted', async () => {
    vi.stubGlobal('fetch', stubFetch())
    const { container } = render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    const view = within(container)

    await view.findByText('{"model": "opus"}')

    fireEvent.change(view.getByPlaceholderText('model or env.FOO'), {
      target: { value: 'model' },
    })
    fireEvent.change(view.getByPlaceholderText('"sonnet" or {"a": 1} or plain text'), {
      target: { value: '"sonnet"' },
    })
    fireEvent.click(view.getByText('Preview diff'))
    await view.findByText('Apply change')

    fireEvent.click(view.getByText('×'))
    expect(view.queryByText('Apply change')).toBeNull()
  })

  it('global workspace offers user and managed tabs; managed is read-only', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} workspace={{ kind: 'global' }} />)
    await screen.findByText('{"model": "opus"}')

    expect(screen.queryByRole('button', { name: 'project' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'managed' }))
    expect(await screen.findByText('{"locked": true}')).toBeDefined()
    expect(screen.getByText(/read-only/)).toBeDefined()
    expect(screen.queryByText('Preview diff')).toBeNull()
  })

  it('project workspace offers only project scopes and queries with the project dir', async () => {
    const fetchMock = stubFetch(PROJECT_SETTINGS)
    vi.stubGlobal('fetch', fetchMock)
    render(<Editor api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} />)
    expect(await screen.findByText('{"model": "sonnet"}')).toBeDefined()

    expect(screen.queryByRole('button', { name: 'user' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'managed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'projectLocal' })).toBeDefined()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/settings?projectDir=${encodeURIComponent('/work/app')}`)
  })

  it('reports the active scope tab to the shell on mount and on tab click', async () => {
    vi.stubGlobal('fetch', stubFetch(PROJECT_SETTINGS))
    const onScopeChange = vi.fn()
    render(
      <Editor
        api={new Api('t')}
        workspace={{ kind: 'project', dir: '/work/app' }}
        onScopeChange={onScopeChange}
      />,
    )
    await screen.findByText('{"model": "sonnet"}')
    expect(onScopeChange).toHaveBeenCalledWith('project') // default tab on mount
    fireEvent.click(screen.getByRole('button', { name: 'projectLocal' }))
    expect(onScopeChange).toHaveBeenLastCalledWith('projectLocal')
  })

  it('honors a jump into a scope tab', async () => {
    vi.stubGlobal('fetch', stubFetch(PROJECT_SETTINGS))
    const consumed = vi.fn()
    render(
      <Editor
        api={new Api('t')}
        workspace={{ kind: 'project', dir: '/work/app' }}
        jump={{ scope: 'projectLocal', path: 'hooks.Stop' }}
        onJumpConsumed={consumed}
      />,
    )
    expect(await screen.findByDisplayValue('hooks.Stop')).toBeDefined()
    expect(consumed).toHaveBeenCalled()
  })
})
