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
    { scope: 'managed', editable: false, state: { path: '/etc/m.json', exists: false } },
  ],
  effective: { value: {}, sources: {} },
}

describe('Hooks view', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows configured events and jumps to the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SETTINGS), { status: 200 })),
    )
    const onEdit = vi.fn()
    render(<Hooks api={new Api('t')} projectDir="" onEdit={onEdit} />)
    expect(await screen.findByText('PreToolUse')).toBeDefined()
    expect(screen.getByText(/echo hi/)).toBeDefined()
    fireEvent.click(screen.getAllByText('Edit in Editor')[0])
    expect(onEdit).toHaveBeenCalledWith('user', 'hooks.PreToolUse')
  })
})
