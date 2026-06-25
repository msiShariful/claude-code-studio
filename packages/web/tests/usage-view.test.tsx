// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { UsageApp } from '../src/usage/UsageApp.js'

const OVERVIEW = {
  today: {
    date: '2026-06-26',
    total_cost: 4.2106,
    turns: 42,
    models: { 'claude-opus-4-6': { input: 1e6, output: 2e5, cacheRead: 0, cacheWrite: 0, cost: 4.2106 } },
  },
  active_block: {
    start: '2026-06-26T08:00:00Z',
    end: '2026-06-26T13:00:00Z',
    active: true,
    turns: 12,
    models: ['claude-opus-4-6'],
    input: 1e6,
    output: 2e5,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 1.84,
    burn_rate_per_hour: 0.9,
    projected_cost: 2.6,
    remaining_ms: 4_320_000,
    elapsed_ms: 7_680_000,
    progress_pct: 72,
  },
  stats: {
    range: 'All time',
    input: 5e6,
    output: 1e6,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 123.45,
    models: ['claude-opus-4-6'],
    project_count: 3,
    session_count: 9,
  },
  heatmap: [{ date: '2026-06-26', cost: 4.21, turns: 42 }],
  generated_at: '2026-06-26T12:00:00Z',
}

const MODELS = { period: 'All time', total_cost: 0, models: [] }

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const body = url.includes('/api/usage/models') ? MODELS : OVERVIEW
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }),
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UsageApp token="t" />
    </MemoryRouter>,
  )
}

describe('Usage area', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the overview hero, burn gauge, and stats from the API', async () => {
    stub()
    renderAt('/usage')
    // active-window burn-down (unique to the gauge)
    expect(await screen.findByText('72% elapsed')).toBeDefined()
    // hero figure appears (Today tile + model legend both show it)
    expect(screen.getAllByText('$4.2106').length).toBeGreaterThan(0)
    // all-time stat tile
    expect(screen.getByText('$123.45')).toBeDefined()
  })

  it('switches sections via the sidebar nav', async () => {
    stub()
    renderAt('/usage/overview')
    await screen.findByText('72% elapsed')

    const nav = screen.getByRole('navigation', { name: 'Usage sections' })
    fireEvent.click(within(nav).getByText('Models'))

    // Models view header (its blurb is unique to that section)
    expect(await screen.findByText(/Cost split across Opus/)).toBeDefined()
  })
})
