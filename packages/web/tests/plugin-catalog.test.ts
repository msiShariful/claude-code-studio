import { describe, expect, it } from 'vitest'
import { PLUGIN_CATALOG, filterPluginCatalog } from '../src/pluginCatalog.js'

describe('filterPluginCatalog', () => {
  it('returns the whole catalog for an empty or whitespace query', () => {
    expect(filterPluginCatalog('')).toHaveLength(PLUGIN_CATALOG.length)
    expect(filterPluginCatalog('   ')).toHaveLength(PLUGIN_CATALOG.length)
  })

  it('matches by title, case-insensitively', () => {
    expect(filterPluginCatalog('SUPERPOWERS').map((e) => e.id)).toContain('superpowers')
  })

  it('matches on the marketplace source, not just the title', () => {
    expect(filterPluginCatalog('davila7').map((e) => e.id)).toEqual(['claude-code-templates'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterPluginCatalog('zzz-no-such-marketplace')).toEqual([])
  })

  it('every entry has a source and a homepage', () => {
    for (const e of PLUGIN_CATALOG) {
      expect(e.source.length).toBeGreaterThan(0)
      expect(e.homepage).toMatch(/^https?:\/\//)
    }
  })
})
