import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGlobalPaths } from '../src/paths.js'

export async function mcpFixture() {
  const home = await mkdtemp(join(tmpdir(), 'ccs-mcp-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'ccs-mcp-proj-'))
  const global = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(global.configDir, { recursive: true })
  return { home, projectDir, global }
}
