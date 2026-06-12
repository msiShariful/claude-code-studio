export type Workspace = { kind: 'global' } | { kind: 'project'; dir: string }

export function workspaceProjectDir(ws: Workspace): string {
  return ws.kind === 'project' ? ws.dir : ''
}

/** Folder basename, tolerant of both path separators (client-side fallback). */
export function projectName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}
