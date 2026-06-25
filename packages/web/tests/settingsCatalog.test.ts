import { describe, expect, it } from 'vitest'
import {
  catalogByGroup,
  catalogKeys,
  SETTINGS_CATALOG,
  SETTINGS_GROUPS,
} from '../src/settingsCatalog.js'

describe('settings catalog', () => {
  it('every entry names a known group and a typed control', () => {
    for (const def of SETTINGS_CATALOG) {
      expect(SETTINGS_GROUPS).toContain(def.group)
      if (def.type === 'enum') expect(def.options?.length).toBeGreaterThan(0)
    }
  })

  it('groups entries in declared order and drops empty groups', () => {
    const groups = catalogByGroup('user').map((g) => g.group)
    expect(groups).toEqual([...SETTINGS_GROUPS])
    // order is monotonic against the canonical list
    expect(groups).toEqual(SETTINGS_GROUPS.filter((g) => groups.includes(g)))
  })

  it('filters by key, title, and description', () => {
    const byKey = catalogByGroup('user', 'cleanupPeriodDays')
    expect(byKey.flatMap((g) => g.defs).map((d) => d.key)).toEqual(['cleanupPeriodDays'])

    const byWord = catalogByGroup('user', 'vim')
    expect(byWord.flatMap((g) => g.defs).map((d) => d.key)).toContain('editorMode')

    expect(catalogByGroup('user', 'no-such-setting')).toEqual([])
  })

  it('catalogKeys covers the dotted permission paths', () => {
    const keys = catalogKeys()
    expect(keys.has('permissions.defaultMode')).toBe(true)
    expect(keys.has('env')).toBe(true)
    expect(keys.size).toBe(SETTINGS_CATALOG.length)
  })
})
