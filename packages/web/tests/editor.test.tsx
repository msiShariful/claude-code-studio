// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Editor } from '../src/views/Editor.js'

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: { path: '/home/u/.claude/settings.json', exists: true, raw: '{"model": "opus"}' },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: { model: 'opus' }, sources: { model: 'user' } },
}

const PREVIEW = {
  filePath: '/home/u/.claude/settings.json',
  before: '{"model": "opus"}',
  after: '{\n  "model": "sonnet"\n}\n',
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n-{"model": "opus"}\n+  "model": "sonnet"',
  expectedHash: 'abc',
  nextValue: { model: 'sonnet' },
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/settings/preview')) {
      return Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(SETTINGS), { status: 200 }))
  })
}

describe('Editor view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the current file and previews a diff for an edit', async () => {
    vi.stubGlobal('fetch', stubFetch())
    render(<Editor api={new Api('t')} projectDir="" />)
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
    const { container } = render(<Editor api={new Api('t')} projectDir="" />)
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
})
