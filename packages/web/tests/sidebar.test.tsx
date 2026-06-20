// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../src/api.js'
import { Sidebar } from '../src/shell/Sidebar.js'
import type { Workspace } from '../src/workspace.js'

/** A fake Api that only answers the four endpoints the sidebar reads for status dots. */
function fakeApi(): Api {
  return {
    settings: () =>
      Promise.resolve({
        entries: [{ scope: 'project', editable: true, state: { path: '', exists: true, value: { model: 'opus' } } }],
        effective: { value: { model: 'opus' }, sources: {} },
      }),
    mcp: () => Promise.resolve({ servers: [{ name: 'github', scope: 'project', config: {} }], warnings: [] }),
    files: () =>
      Promise.resolve({
        user: { claudeMd: { path: '', exists: false }, agents: [], skills: [] },
        project: { claudeMd: { path: '', exists: true }, agents: [], skills: [] },
      }),
    plugins: () => Promise.resolve({ cliFound: true, plugins: [], marketplaces: [] }),
  } as unknown as Api
}

const PROJECT: Workspace = { kind: 'project', dir: '/work/app' }

type Props = Partial<Parameters<typeof Sidebar>[0]>

/** Render the Sidebar with sensible defaults; pass overrides per test. */
function renderBar(props: Props = {}) {
  const merged = {
    workspace: PROJECT,
    api: fakeApi(),
    active: 'home',
    onOpen: () => {},
    onEditSettings: () => {},
    ...props,
  }
  return render(<Sidebar {...merged} />)
}

const rowFor = (label: string) => screen.getByText(label).closest('button')!

describe('Sidebar file tree', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the workspace root and the .claude/ folder open by default', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByText('app')).toBeDefined() // project root label
    expect(within(nav).getByText('.claude/')).toBeDefined()
    // children of an open .claude/ are visible
    expect(within(nav).getByText('settings.json')).toBeDefined()
    expect(within(nav).getByText('settings.local.json')).toBeDefined()
  })

  it('collapses and re-expands the .claude/ folder', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(nav).getByText('.claude/'))
    expect(within(nav).queryByText('settings.json')).toBeNull()
    fireEvent.click(within(nav).getByText('.claude/'))
    expect(within(nav).getByText('settings.json')).toBeDefined()
  })

  it('routes a file node to its managing section', () => {
    const onOpen = vi.fn()
    renderBar({ onOpen })
    fireEvent.click(screen.getByText('.mcp.json'))
    expect(onOpen).toHaveBeenCalledWith('tools')
  })

  it('opens each settings file on its own scope tab, not plain navigation', () => {
    const onOpen = vi.fn()
    const onEditSettings = vi.fn()
    renderBar({ onOpen, onEditSettings })
    fireEvent.click(screen.getByText('settings.json'))
    expect(onEditSettings).toHaveBeenLastCalledWith('project')
    fireEvent.click(screen.getByText('settings.local.json'))
    expect(onEditSettings).toHaveBeenLastCalledWith('projectLocal')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('routes each file node to its own section (no shared tabs)', () => {
    const onOpen = vi.fn()
    renderBar({ onOpen })
    fireEvent.click(screen.getByText('CLAUDE.md'))
    expect(onOpen).toHaveBeenLastCalledWith('memory')
    fireEvent.click(screen.getByText('agents/'))
    expect(onOpen).toHaveBeenLastCalledWith('agents')
    fireEvent.click(screen.getByText('skills/'))
    expect(onOpen).toHaveBeenLastCalledWith('skills')
  })

  it('mirrors the Editor scope tab: settingsScope drives which file glows', () => {
    const { rerender } = renderBar({ active: 'settings', settingsScope: 'project' })
    expect(rowFor('settings.json').className).toContain('active')
    expect(rowFor('settings.local.json').className).not.toContain('active')

    // switching the tab to projectLocal moves the highlight, no sidebar click needed
    rerender(
      <Sidebar
        workspace={PROJECT}
        api={fakeApi()}
        active="settings"
        settingsScope="projectLocal"
        onOpen={() => {}}
        onEditSettings={() => {}}
      />,
    )
    expect(rowFor('settings.local.json').className).toContain('active')
    expect(rowFor('settings.json').className).not.toContain('active')
  })

  it('highlights the file node matching the active section', () => {
    renderBar({ active: 'skills' })
    expect(rowFor('skills/').className).toContain('active')
    expect(rowFor('agents/').className).not.toContain('active')
  })

  it('maps settings.json to the user tab outside a project', () => {
    const onEditSettings = vi.fn()
    renderBar({ workspace: { kind: 'user' }, onEditSettings })
    fireEvent.click(screen.getByText('settings.json'))
    expect(onEditSettings).toHaveBeenCalledWith('user')
  })

  it('marks a configured artifact with a filled status dot', async () => {
    renderBar()
    // .mcp.json has a server in scope → its dot is "on"
    const dot = await screen.findByTestId('dot-mcp-json')
    expect(dot.className).toContain('on')
    expect(dot.className).not.toContain('off')
    // skills/ has nothing → "off"
    expect(screen.getByTestId('dot-skills').className).toContain('off')
  })
})
