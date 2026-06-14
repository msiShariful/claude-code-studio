// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonView, foldRegions } from '../src/components/JsonView.js'

afterEach(cleanup)

const SAMPLE = `{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(cat:*)"
    ]
  },
  "model": "opus"
}`

describe('foldRegions', () => {
  it('finds every multi-line bracket region with its open char', () => {
    const regions = foldRegions(SAMPLE)
    // outer object 0..8, permissions object 1..6, allow array 2..5
    expect(regions).toEqual([
      { start: 2, end: 5, open: '[' },
      { start: 1, end: 6, open: '{' },
      { start: 0, end: 8, open: '{' },
    ])
  })

  it('ignores brackets inside double-quoted strings', () => {
    // The "}" and "]" live inside string values and must not match.
    const raw = '{\n  "rule": "Bash(grep }])",\n  "n": 1\n}'
    expect(foldRegions(raw)).toEqual([{ start: 0, end: 3, open: '{' }])
  })

  it('respects backslash escapes inside strings', () => {
    const raw = '{\n  "p": "a\\"{ still string",\n  "q": 2\n}'
    expect(foldRegions(raw)).toEqual([{ start: 0, end: 3, open: '{' }])
  })

  it('skips single-line pairs (nothing to fold)', () => {
    expect(foldRegions('{ "a": 1 }')).toEqual([])
  })
})

describe('JsonView', () => {
  it('renders a line number for every line', () => {
    render(<JsonView raw={SAMPLE} />)
    const nums = screen.getAllByText(/^\d+$/).map((n) => n.textContent)
    expect(nums).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('collapses a region, hiding its inner lines, then expands again', () => {
    render(<JsonView raw={SAMPLE} />)
    // Collapse the "allow" array (opens on line 3).
    const toggle = screen.getByRole('button', { name: /Collapse lines from 3/ })
    fireEvent.click(toggle)

    // Inner lines 4 and 5 plus the lone closer on line 6 fold into the opener;
    // line 3 keeps its toggle and line 7 (the next sibling) stays visible.
    let nums = screen.getAllByText(/^\d+$/).map((n) => n.textContent)
    expect(nums).not.toContain('4')
    expect(nums).not.toContain('5')
    expect(nums).not.toContain('6')
    expect(nums).toContain('3')
    expect(nums).toContain('7')

    // The collapsed opener now advertises expansion and shows the closer.
    const expand = screen.getByRole('button', { name: /Expand lines from 3/ })
    fireEvent.click(expand)
    nums = screen.getAllByText(/^\d+$/).map((n) => n.textContent)
    expect(nums).toContain('4')
    expect(nums).toContain('5')
  })

  it('hides nested toggles when an outer region is collapsed', () => {
    render(<JsonView raw={SAMPLE} />)
    // Collapsing the outer object (line 1) should swallow the inner toggles.
    fireEvent.click(screen.getByRole('button', { name: /Collapse lines from 1/ }))
    expect(screen.queryByRole('button', { name: /lines from 2/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /lines from 3/ })).toBeNull()
  })
})
