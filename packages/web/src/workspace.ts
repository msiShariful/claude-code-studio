export type WorkspaceKind = 'global' | 'user' | 'project'

export type Workspace =
  | { kind: 'global' }
  | { kind: 'user' }
  | { kind: 'project'; dir: string }

export function workspaceProjectDir(ws: Workspace): string {
  return ws.kind === 'project' ? ws.dir : ''
}

/**
 * Which settings/file scopes a workspace edits: a project edits project + local
 * files; Global and User both edit the machine-level (~/.claude) config — User is
 * the focused view, Global the aggregate that also lists every project's items.
 */
export function isProjectWorkspace(ws: Workspace): ws is { kind: 'project'; dir: string } {
  return ws.kind === 'project'
}

/** Folder basename, tolerant of both path separators (client-side fallback). */
export function projectName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

/**
 * URL-safe id for a project directory. base64url keeps absolute paths (with their
 * slashes) inside a single route segment, so deep links survive a page reload.
 */
export function encodeProjectId(dir: string): string {
  const b64 = btoa(unescape(encodeURIComponent(dir)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeProjectId(id: string): string {
  const b64 = id.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return decodeURIComponent(escape(atob(b64)))
  } catch {
    return ''
  }
}
