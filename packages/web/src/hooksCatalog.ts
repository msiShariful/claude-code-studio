// The hook lifecycle events Claude Code fires, with the shape of each event's
// matcher, so the Hooks view can offer a labelled add-a-hook form instead of
// hand-edited JSON. Plus small, pure transforms over an event's matcher-group
// array — add/remove a single command without ever rewriting the hooks Studio
// can't represent (HTTP/MCP/prompt hooks pass through untouched).

export type MatcherKind = 'none' | 'tool' | 'enum' | 'free'

export interface HookEventDef {
  event: string
  description: string
  matcher: MatcherKind
  /** what the matcher selects, e.g. "Tool" or "Source" — shown as the field label */
  matcherLabel?: string
  /** fixed choices for `enum` matchers */
  options?: string[]
  /** type-and-pick hints for `tool` / `free` matchers */
  suggestions?: string[]
  placeholder?: string
}

const TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch']

export const HOOK_EVENTS: readonly HookEventDef[] = [
  {
    event: 'PreToolUse',
    description: 'Runs before a tool call; can block or modify it.',
    matcher: 'tool',
    matcherLabel: 'Tool',
    suggestions: TOOLS,
    placeholder: 'Bash, Edit|Write, or mcp__server__.*',
  },
  {
    event: 'PostToolUse',
    description: 'Runs after a tool call completes.',
    matcher: 'tool',
    matcherLabel: 'Tool',
    suggestions: TOOLS,
    placeholder: 'Bash, Edit|Write, or mcp__server__.*',
  },
  {
    event: 'UserPromptSubmit',
    description: 'Runs when you submit a prompt, before Claude sees it.',
    matcher: 'none',
  },
  {
    event: 'Notification',
    description: 'Runs when Claude Code sends a notification.',
    matcher: 'free',
    matcherLabel: 'Type',
    placeholder: 'permission_prompt, idle_prompt… (blank = all)',
  },
  {
    event: 'Stop',
    description: 'Runs when Claude finishes responding.',
    matcher: 'none',
  },
  {
    event: 'SubagentStop',
    description: 'Runs when a subagent finishes.',
    matcher: 'free',
    matcherLabel: 'Agent',
    suggestions: ['general-purpose', 'Explore', 'Plan'],
    placeholder: 'agent name (blank = all)',
  },
  {
    event: 'PreCompact',
    description: 'Runs before the conversation context is compacted.',
    matcher: 'enum',
    matcherLabel: 'Trigger',
    options: ['manual', 'auto'],
  },
  {
    event: 'SessionStart',
    description: 'Runs when a session starts or resumes.',
    matcher: 'enum',
    matcherLabel: 'Source',
    options: ['startup', 'resume', 'clear', 'compact'],
  },
  {
    event: 'SessionEnd',
    description: 'Runs when a session ends.',
    matcher: 'none',
  },
]

export interface HookCommand {
  type: string
  command?: string
  timeout?: number
  statusMessage?: string
  [k: string]: unknown
}

export interface HookGroup {
  matcher?: string
  hooks: HookCommand[]
  [k: string]: unknown
}

/** A single command flattened out of its group, with the indices to address it. */
export interface HookRow {
  matcher?: string
  cmd: HookCommand
  gi: number
  hi: number
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read a stored event value into well-formed groups, preserving unknown fields. */
export function asHookGroups(value: unknown): HookGroup[] {
  if (!Array.isArray(value)) return []
  const out: HookGroup[] = []
  for (const item of value) {
    if (!isObj(item)) continue
    const hooks = Array.isArray(item.hooks) ? (item.hooks.filter(isObj) as HookCommand[]) : []
    out.push({ ...(item as HookGroup), hooks })
  }
  return out
}

/** Two matchers are the same target when both are empty or strictly equal. */
export function matcherEq(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') === (b ?? '')
}

/** Flatten groups to addressable per-command rows for display. */
export function hookRows(groups: HookGroup[]): HookRow[] {
  return groups.flatMap((g, gi) =>
    g.hooks.map((cmd, hi) => ({ matcher: g.matcher, cmd, gi, hi })),
  )
}

/** Append a command, merging into the existing group for that matcher if any. */
export function addHook(
  groups: HookGroup[],
  matcher: string | undefined,
  cmd: HookCommand,
): HookGroup[] {
  const next = groups.map((g) => ({ ...g, hooks: [...g.hooks] }))
  const target = next.find((g) => matcherEq(g.matcher, matcher))
  if (target) {
    target.hooks.push(cmd)
  } else {
    next.push(matcher ? { matcher, hooks: [cmd] } : { hooks: [cmd] })
  }
  return next
}

/** Remove one command, dropping its group if that empties it. */
export function removeHookAt(groups: HookGroup[], gi: number, hi: number): HookGroup[] {
  const next = groups.map((g) => ({ ...g, hooks: [...g.hooks] }))
  const group = next[gi]
  if (!group) return next
  group.hooks.splice(hi, 1)
  if (group.hooks.length === 0) next.splice(gi, 1)
  return next
}
