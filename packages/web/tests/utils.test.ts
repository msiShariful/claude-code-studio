import { describe, expect, it } from 'vitest'
import { diffLineKind, flattenLeaves, parseEditValue } from '../src/utils.js'

describe('flattenLeaves', () => {
  it('flattens nested objects to dotted paths with their sources', () => {
    const leaves = flattenLeaves(
      { model: 'opus', env: { FOO: '1' }, permissions: { allow: ['Read'] } },
      { model: 'user', 'env.FOO': 'projectLocal', 'permissions.allow': 'managed' },
    )
    expect(leaves).toEqual([
      { path: 'model', value: 'opus', source: 'user' },
      { path: 'env.FOO', value: '1', source: 'projectLocal' },
      { path: 'permissions.allow', value: ['Read'], source: 'managed' },
    ])
  })

  it('returns an empty list for empty settings', () => {
    expect(flattenLeaves({}, {})).toEqual([])
  })
})

describe('diffLineKind', () => {
  it('classifies unified diff lines', () => {
    expect(diffLineKind('+++ b/settings.json')).toBe('meta')
    expect(diffLineKind('--- a/settings.json')).toBe('meta')
    expect(diffLineKind('@@ -1,3 +1,4 @@')).toBe('meta')
    expect(diffLineKind('==='.repeat(3))).toBe('meta')
    expect(diffLineKind('Index: /x.json')).toBe('meta')
    expect(diffLineKind('+  "model": "sonnet"')).toBe('add')
    expect(diffLineKind('-  "model": "opus"')).toBe('del')
    expect(diffLineKind('   "env": {}')).toBe('ctx')
  })
})

describe('parseEditValue', () => {
  it('parses valid JSON', () => {
    expect(parseEditValue('true')).toBe(true)
    expect(parseEditValue('3')).toBe(3)
    expect(parseEditValue('{"a":1}')).toEqual({ a: 1 })
    expect(parseEditValue('"quoted"')).toBe('quoted')
  })

  it('falls back to the raw string for non-JSON', () => {
    expect(parseEditValue('sonnet')).toBe('sonnet')
  })
})
