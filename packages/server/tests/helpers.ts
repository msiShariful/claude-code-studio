import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGlobalPaths } from '@claude-code-studio/core'
import { buildServer, type BuildOptions } from '../src/server.js'

export const TOKEN = 't-test-token'
export const auth = { authorization: `Bearer ${TOKEN}` }

export async function fixture(overrides: Partial<BuildOptions> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'ccs-srv-'))
  const globalPaths = getGlobalPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, 'linux', home)
  await mkdir(globalPaths.configDir, { recursive: true })
  const backupsRoot = join(home, 'backups')
  const app = buildServer({ token: TOKEN, globalPaths, backupsRoot, ...overrides })
  return { home, globalPaths, backupsRoot, app }
}
