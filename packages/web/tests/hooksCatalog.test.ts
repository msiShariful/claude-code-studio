import { describe, expect, it } from 'vitest'
import {
  addHook,
  asHookGroups,
  HOOK_EVENTS,
  hookRows,
  matcherEq,
  removeHookAt,
  type HookGroup,
} from '../src/hooksCatalog.js'

const GROUPS: HookGroup[] = [
  { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] },
  { hooks: [{ type: 'command', command: 'echo b' }] },
]

describe('hooks catalog', () => {
  it('every enum event lists its allowed matcher values', () => {
    for (const def of HOOK_EVENTS) {
      if (def.matcher === 'enum') expect(def.options?.length).toBeGreaterThan(0)
    }
  })

  it('normalizes a stored value into well-formed groups and ignores junk', () => {
    expect(asHookGroups(undefined)).toEqual([])
    expect(asHookGroups('nope')).toEqual([])
    expect(asHookGroups([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }, 7])).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] },
    ])
  })

  it('preserves unknown fields on groups and commands', () => {
    const groups = asHookGroups([{ matcher: 'Read', custom: 1, hooks: [{ type: 'http', url: 'x' }] }])
    expect(groups[0].custom).toBe(1)
    expect(groups[0].hooks[0]).toEqual({ type: 'http', url: 'x' })
  })

  it('flattens groups to addressable rows', () => {
    expect(hookRows(GROUPS)).toEqual([
      { matcher: 'Bash', cmd: { type: 'command', command: 'echo a' }, gi: 0, hi: 0 },
      { matcher: undefined, cmd: { type: 'command', command: 'echo b' }, gi: 1, hi: 0 },
    ])
  })

  it('adds into the matching group, else opens a new one', () => {
    const merged = addHook(GROUPS, 'Bash', { type: 'command', command: 'echo c' })
    expect(merged[0].hooks).toHaveLength(2)
    expect(merged).toHaveLength(2)

    const fresh = addHook(GROUPS, 'Edit', { type: 'command', command: 'echo d' })
    expect(fresh).toHaveLength(3)
    expect(fresh[2]).toEqual({ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo d' }] })

    // no matcher → a matcher-less group, never one with an empty string
    const noMatcher = addHook([], undefined, { type: 'command', command: 'x' })
    expect(noMatcher[0]).toEqual({ hooks: [{ type: 'command', command: 'x' }] })
  })

  it('matcherEq treats blank and undefined as the same target', () => {
    expect(matcherEq(undefined, '')).toBe(true)
    expect(matcherEq('Bash', 'Bash')).toBe(true)
    expect(matcherEq('Bash', 'Read')).toBe(false)
  })

  it('removes a command and drops the group when it empties', () => {
    expect(removeHookAt(GROUPS, 0, 0)).toEqual([
      { hooks: [{ type: 'command', command: 'echo b' }] },
    ])
    // a no-op index is harmless
    expect(removeHookAt(GROUPS, 9, 9)).toHaveLength(2)
  })
})
