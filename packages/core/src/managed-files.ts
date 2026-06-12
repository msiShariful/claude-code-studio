import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GlobalPaths, ProjectPaths } from './paths.js'

export type FileKind = 'claudeMd' | 'keybindings' | 'agent' | 'skill'
export type FileScope = 'user' | 'project'

export interface ManagedFileRef {
  kind: FileKind
  scope: FileScope
  /** Required for agent (foo.md) and skill (skill-dir-name); forbidden otherwise. */
  name?: string
}

/** No `/`, no leading dot — traversal cannot be expressed. */
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * The safety boundary for file editing: clients send {kind, scope, name};
 * the server resolves the absolute path against known roots only.
 */
export function resolveManagedFile(
  ref: ManagedFileRef,
  global: GlobalPaths,
  project?: ProjectPaths,
): string {
  if (ref.scope === 'project' && !project) {
    throw new Error('project paths are required for the project scope')
  }
  const roots = ref.scope === 'user' ? global : project!
  switch (ref.kind) {
    case 'claudeMd':
      return roots.claudeMd
    case 'keybindings':
      if (ref.scope !== 'user') throw new Error('keybindings exist only in the user scope')
      return global.keybindings
    case 'agent':
      if (!ref.name || !AGENT_NAME_RE.test(ref.name)) {
        throw new Error(`Invalid agent file name: ${JSON.stringify(ref.name)}`)
      }
      return join(roots.agentsDir, ref.name)
    case 'skill':
      if (!ref.name || !SKILL_NAME_RE.test(ref.name)) {
        throw new Error(`Invalid skill name: ${JSON.stringify(ref.name)}`)
      }
      return join(roots.skillsDir, ref.name, 'SKILL.md')
  }
}

export interface NamedFile {
  name: string
  path: string
}

export interface ScopeFiles {
  claudeMd: { path: string; exists: boolean }
  keybindings?: { path: string; exists: boolean }
  agents: NamedFile[]
  skills: NamedFile[]
}

export interface ManagedFilesListing {
  user: ScopeFiles
  project?: ScopeFiles
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function listAgents(agentsDir: string): Promise<NamedFile[]> {
  let names: string[]
  try {
    names = await readdir(agentsDir)
  } catch {
    return []
  }
  return names
    .filter((n) => AGENT_NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, path: join(agentsDir, name) }))
}

async function listSkills(skillsDir: string): Promise<NamedFile[]> {
  let names: string[]
  try {
    names = await readdir(skillsDir)
  } catch {
    return []
  }
  const skills: NamedFile[] = []
  for (const name of names.filter((n) => SKILL_NAME_RE.test(n)).sort()) {
    const path = join(skillsDir, name, 'SKILL.md')
    if (await fileExists(path)) skills.push({ name, path })
  }
  return skills
}

async function scopeFiles(
  roots: Pick<GlobalPaths, 'claudeMd' | 'agentsDir' | 'skillsDir'>,
  keybindings?: string,
): Promise<ScopeFiles> {
  const result: ScopeFiles = {
    claudeMd: { path: roots.claudeMd, exists: await fileExists(roots.claudeMd) },
    agents: await listAgents(roots.agentsDir),
    skills: await listSkills(roots.skillsDir),
  }
  if (keybindings) {
    result.keybindings = { path: keybindings, exists: await fileExists(keybindings) }
  }
  return result
}

export async function listManagedFiles(
  global: GlobalPaths,
  project?: ProjectPaths,
): Promise<ManagedFilesListing> {
  const listing: ManagedFilesListing = {
    user: await scopeFiles(global, global.keybindings),
  }
  if (project) {
    listing.project = await scopeFiles(project)
  }
  return listing
}
