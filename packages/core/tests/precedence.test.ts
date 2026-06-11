import { describe, expect, it } from 'vitest'
import type { SettingsFileEntry } from '../src/settings.js'
import { resolveEffectiveSettings } from '../src/precedence.js'

function entry(
  scope: SettingsFileEntry['scope'],
  value: Record<string, unknown> | undefined,
): SettingsFileEntry {
  return {
    scope,
    editable: scope !== 'managed',
    state: { path: `/fake/${scope}.json`, exists: value !== undefined, value },
  }
}

describe('resolveEffectiveSettings', () => {
  it('merges scopes lowest-to-highest and records the winning source per leaf', () => {
    const result = resolveEffectiveSettings([
      entry('user', { model: 'opus', env: { FOO: '1', BAR: '2' } }),
      entry('project', undefined),
      entry('projectLocal', { env: { BAR: '3' } }),
      entry('managed', { model: 'sonnet' }),
    ])
    expect(result.value).toEqual({ model: 'sonnet', env: { FOO: '1', BAR: '3' } })
    expect(result.sources['model']).toBe('managed')
    expect(result.sources['env.FOO']).toBe('user')
    expect(result.sources['env.BAR']).toBe('projectLocal')
  })

  it('replaces arrays wholesale (documented v1 simplification)', () => {
    const result = resolveEffectiveSettings([
      entry('user', { permissions: { allow: ['Bash(ls:*)'] } }),
      entry('projectLocal', { permissions: { allow: ['Read'] } }),
      entry('managed', undefined),
    ])
    expect(result.value).toEqual({ permissions: { allow: ['Read'] } })
    expect(result.sources['permissions.allow']).toBe('projectLocal')
  })

  it('returns empty settings when no file exists', () => {
    const result = resolveEffectiveSettings([entry('user', undefined), entry('managed', undefined)])
    expect(result.value).toEqual({})
    expect(result.sources).toEqual({})
  })

  it('ignores prototype-polluting keys in settings files', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const result = resolveEffectiveSettings([entry('user', malicious), entry('managed', undefined)])
    expect(result.value).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('drops stale nested sources when a higher scope replaces an object with a scalar', () => {
    const result = resolveEffectiveSettings([
      entry('user', { env: { FOO: '1' } }),
      entry('managed', { env: 'off' }),
    ])
    expect(result.value).toEqual({ env: 'off' })
    expect(result.sources['env']).toBe('managed')
    expect(result.sources['env.FOO']).toBeUndefined()
  })
})
