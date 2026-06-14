import { describe, expect, it } from 'vitest'
import { MCP_CATALOG, filterCatalog } from '../src/mcpCatalog.js'

describe('filterCatalog', () => {
  it('returns the whole catalog for an empty or whitespace query', () => {
    expect(filterCatalog('')).toHaveLength(MCP_CATALOG.length)
    expect(filterCatalog('   ')).toHaveLength(MCP_CATALOG.length)
  })

  it('matches by title, case-insensitively', () => {
    const hits = filterCatalog('PLAYWRIGHT')
    expect(hits.map((e) => e.id)).toContain('playwright')
  })

  it('matches on the command line / package name, not just the title', () => {
    const hits = filterCatalog('@modelcontextprotocol/server-memory')
    expect(hits.map((e) => e.id)).toEqual(['memory'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterCatalog('zzz-no-such-server')).toEqual([])
  })

  it('every entry has a runnable command and a homepage', () => {
    for (const e of MCP_CATALOG) {
      expect(e.command.length).toBeGreaterThan(0)
      expect(e.args.length).toBeGreaterThan(0)
      expect(e.homepage).toMatch(/^https?:\/\//)
    }
  })
})
