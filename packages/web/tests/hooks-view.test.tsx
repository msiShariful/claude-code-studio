// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Api } from '../src/api.js'
import { Hooks } from '../src/views/Hooks.js'

const SETTINGS = {
  entries: [
    {
      scope: 'user',
      editable: true,
      state: {
        path: '/h/.claude/settings.json',
        exists: true,
        value: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      },
    },
    {
      scope: 'project',
      editable: true,
      state: {
        path: '/work/app/.claude/settings.json',
        exists: true,
        value: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } },
      },
    },
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: {}, sources: {} },
}

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
  )
}

describe('Hooks view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('global workspace shows user hooks only and jumps to the editor', async () => {
    stub()
    const onEdit = vi.fn()
    render(<Hooks api={new Api('t')} workspace={{ kind: 'global' }} onEdit={onEdit} />)
    expect(await screen.findByText('PreToolUse')).toBeDefined()
    expect(screen.getByText(/echo hi/)).toBeDefined()
    // project-scope hook config must not leak into the global workspace
    expect(screen.queryByText(/say done/)).toBeNull()
    fireEvent.click(screen.getAllByText('Edit in Editor')[0])
    expect(onEdit).toHaveBeenCalledWith('user', 'hooks.PreToolUse')
  })

  it('project workspace shows project hooks only and adds at project scope', async () => {
    stub()
    const onEdit = vi.fn()
    render(
      <Hooks api={new Api('t')} workspace={{ kind: 'project', dir: '/work/app' }} onEdit={onEdit} />,
    )
    expect(await screen.findByText(/say done/)).toBeDefined()
    expect(screen.queryByText(/echo hi/)).toBeNull()
    // an unconfigured event offers to add at the project scope
    fireEvent.click(screen.getAllByText('Edit in Editor')[1])
    expect(onEdit).toHaveBeenCalledWith('project', expect.stringMatching(/^hooks\./))
  })
})
