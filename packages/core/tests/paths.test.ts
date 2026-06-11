import { describe, expect, it } from 'vitest'
import { getGlobalPaths, getProjectPaths } from '../src/paths.js'

describe('getGlobalPaths', () => {
  it('defaults to ~/.claude and ~/.claude.json', () => {
    const p = getGlobalPaths({}, 'darwin', '/Users/alice')
    expect(p.configDir).toBe('/Users/alice/.claude')
    expect(p.settings).toBe('/Users/alice/.claude/settings.json')
    expect(p.claudeJson).toBe('/Users/alice/.claude.json')
    expect(p.keybindings).toBe('/Users/alice/.claude/keybindings.json')
    expect(p.claudeMd).toBe('/Users/alice/.claude/CLAUDE.md')
    expect(p.agentsDir).toBe('/Users/alice/.claude/agents')
    expect(p.skillsDir).toBe('/Users/alice/.claude/skills')
    expect(p.pluginsDir).toBe('/Users/alice/.claude/plugins')
  })

  it('treats an empty CLAUDE_CONFIG_DIR as unset', () => {
    const p = getGlobalPaths({ CLAUDE_CONFIG_DIR: '' }, 'linux', '/home/alice')
    expect(p.configDir).toBe('/home/alice/.claude')
    expect(p.claudeJson).toBe('/home/alice/.claude.json')
  })

  it('honors CLAUDE_CONFIG_DIR for the config dir and .claude.json', () => {
    const p = getGlobalPaths({ CLAUDE_CONFIG_DIR: '/tmp/cc' }, 'linux', '/home/alice')
    expect(p.configDir).toBe('/tmp/cc')
    expect(p.settings).toBe('/tmp/cc/settings.json')
    expect(p.claudeJson).toBe('/tmp/cc/.claude.json')
  })

  it('returns the platform-specific managed settings path', () => {
    expect(getGlobalPaths({}, 'darwin', '/Users/a').managedSettings).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    )
    expect(getGlobalPaths({}, 'linux', '/home/a').managedSettings).toBe(
      '/etc/claude-code/managed-settings.json',
    )
    expect(getGlobalPaths({}, 'win32', 'C:\\Users\\a').managedSettings).toBe(
      'C:\\ProgramData\\ClaudeCode\\managed-settings.json',
    )
  })
})

describe('getProjectPaths', () => {
  it('maps all project-scope files under the project dir', () => {
    const p = getProjectPaths('/work/app')
    expect(p.settings).toBe('/work/app/.claude/settings.json')
    expect(p.settingsLocal).toBe('/work/app/.claude/settings.local.json')
    expect(p.mcpJson).toBe('/work/app/.mcp.json')
    expect(p.claudeMd).toBe('/work/app/CLAUDE.md')
    expect(p.agentsDir).toBe('/work/app/.claude/agents')
    expect(p.projectDir).toBe('/work/app')
    expect(p.skillsDir).toBe('/work/app/.claude/skills')
  })
})
