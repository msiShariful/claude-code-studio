import { homedir as osHomedir } from 'node:os'
import { join } from 'node:path'

export interface GlobalPaths {
  configDir: string
  settings: string
  claudeJson: string
  keybindings: string
  claudeMd: string
  agentsDir: string
  skillsDir: string
  pluginsDir: string
  managedSettings: string
}

export function getGlobalPaths(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = osHomedir(),
): GlobalPaths {
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const claudeJson = env.CLAUDE_CONFIG_DIR
    ? join(configDir, '.claude.json')
    : join(home, '.claude.json')
  return {
    configDir,
    settings: join(configDir, 'settings.json'),
    claudeJson,
    keybindings: join(configDir, 'keybindings.json'),
    claudeMd: join(configDir, 'CLAUDE.md'),
    agentsDir: join(configDir, 'agents'),
    skillsDir: join(configDir, 'skills'),
    pluginsDir: join(configDir, 'plugins'),
    managedSettings: managedSettingsPath(platform),
  }
}

function managedSettingsPath(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json'
  }
  if (platform === 'win32') {
    return 'C:\\ProgramData\\ClaudeCode\\managed-settings.json'
  }
  return '/etc/claude-code/managed-settings.json'
}

export interface ProjectPaths {
  projectDir: string
  settings: string
  settingsLocal: string
  mcpJson: string
  claudeMd: string
  agentsDir: string
  skillsDir: string
}

export function getProjectPaths(projectDir: string): ProjectPaths {
  const dotClaude = join(projectDir, '.claude')
  return {
    projectDir,
    settings: join(dotClaude, 'settings.json'),
    settingsLocal: join(dotClaude, 'settings.local.json'),
    mcpJson: join(projectDir, '.mcp.json'),
    claudeMd: join(projectDir, 'CLAUDE.md'),
    agentsDir: join(dotClaude, 'agents'),
    skillsDir: join(dotClaude, 'skills'),
  }
}
