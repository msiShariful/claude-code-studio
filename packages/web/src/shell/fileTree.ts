// The sidebar, reimagined as the real Claude Code config tree. Each node is an
// artifact you'd actually find on disk (CLAUDE.md, .mcp.json, .claude/settings.json,
// agents/, …); `section` routes a node to the view that manages it. nav.ts stays the
// routing source of truth — this is just how the same sections are *shown*.

import type { WorkspaceKind } from '../workspace.js'
import type { TreeIcon } from './icons.js'

export interface TreeNode {
  /** stable id — used for active highlight, expand state, and status dots */
  id: string
  /** the on-disk name, shown verbatim in mono */
  label: string
  icon: TreeIcon
  /** section key to open; omit for a pure container (expand/collapse only) */
  section?: string
  /** plain-language explanation, revealed on row hover (the teaching layer) */
  info: string
  /** which workspace scopes show this node; default = all */
  kinds?: readonly WorkspaceKind[]
  /** children make this an expandable folder */
  children?: TreeNode[]
  /** expandable folders start open */
  defaultOpen?: boolean
}

const TREE: readonly TreeNode[] = [
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    icon: 'md',
    section: 'memory',
    info: 'Standing instructions Claude reads every session — your memory file.',
  },
  {
    id: 'mcp-json',
    label: '.mcp.json',
    icon: 'json',
    section: 'tools',
    info: 'External tools and data sources Claude can reach, via MCP servers.',
  },
  {
    id: 'dot-claude',
    label: '.claude/',
    icon: 'folder',
    defaultOpen: true,
    info: 'Your Claude configuration directory.',
    children: [
      {
        id: 'settings',
        label: 'settings.json',
        icon: 'json',
        section: 'settings',
        info: 'Permissions, model, and environment — what Claude may do and how it behaves.',
      },
      {
        id: 'settings-local',
        label: 'settings.local.json',
        icon: 'json',
        section: 'settings',
        kinds: ['project'],
        info: 'Your personal overrides for this project, kept out of version control.',
      },
      {
        id: 'agents',
        label: 'agents/',
        icon: 'folder',
        section: 'agents',
        info: 'Custom subagents you can hand specialized tasks.',
      },
      {
        id: 'skills',
        label: 'skills/',
        icon: 'folder',
        section: 'skills',
        info: 'Reusable skills Claude can invoke on demand.',
      },
      {
        id: 'hooks',
        label: 'hooks/',
        icon: 'folder',
        section: 'automation',
        info: 'Commands that run automatically on Claude’s events.',
      },
      {
        id: 'plugins',
        label: 'plugins/',
        icon: 'folder',
        section: 'extensions',
        info: 'Bundles of agents, commands, and tools from marketplaces.',
      },
      {
        id: 'keybindings',
        label: 'keybindings.json',
        icon: 'json',
        section: 'keybindings',
        kinds: ['global', 'user'],
        info: 'Your own keyboard shortcuts for Claude Code.',
      },
    ],
  },
  {
    id: 'effective',
    label: 'effective config',
    icon: 'layers',
    section: 'effective',
    kinds: ['project'],
    info: 'The merged settings Claude actually uses here, and where each value comes from.',
  },
  {
    id: 'backups',
    label: 'backups',
    icon: 'history',
    section: 'history',
    kinds: ['global'],
    info: 'Every change Studio makes is snapshotted first — restore any earlier version.',
  },
]

function showsFor(node: TreeNode, kind: WorkspaceKind): boolean {
  return !node.kinds || node.kinds.includes(kind)
}

/** The tree for a workspace, pruned to the nodes that scope applies to. */
export function fileTree(kind: WorkspaceKind): TreeNode[] {
  const prune = (nodes: readonly TreeNode[]): TreeNode[] =>
    nodes
      .filter((n) => showsFor(n, kind))
      .map((n) => (n.children ? { ...n, children: prune(n.children) } : n))
  return prune(TREE)
}

/** Depth-first flatten, for active-node resolution and status mapping. */
export function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.children ? [n, ...flattenTree(n.children)] : [n]))
}
