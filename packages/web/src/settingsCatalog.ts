// A curated, offline catalog of the settings.json keys most people actually
// reach for, so the editor can render each as a labelled, type-appropriate
// control instead of asking the user to remember dotted paths and JSON. This is
// a static list on purpose — no network, in keeping with Studio's localhost-only
// design. It is deliberately NOT exhaustive: managed-only policy keys and deep
// niche flags are left to the Advanced (raw) editor. Mirrors mcpCatalog.ts.

export type SettingScope = 'user' | 'project' | 'projectLocal'

export type SettingType = 'boolean' | 'enum' | 'string' | 'number' | 'stringList' | 'stringMap'

export interface EnumOption {
  value: string
  /** plain-language label; falls back to the raw value */
  label?: string
  /** one-line note shown beside the option */
  hint?: string
}

export interface SettingDef {
  /** dotted path written to settings.json; also the search id */
  key: string
  /** plain-language name */
  title: string
  /** one-line description of what it does */
  description: string
  type: SettingType
  /** group heading this setting sits under */
  group: string
  /** allowed values, for `enum` */
  options?: EnumOption[]
  /** type-and-pick suggestions, for `string` (rendered as a datalist) */
  suggestions?: string[]
  /** the value Claude uses when the key is absent, shown as a quiet hint */
  default?: unknown
  /** example text for `string` / `number` / list rows */
  placeholder?: string
  /** scopes where this key is meaningful; omit = all editable scopes */
  scopes?: SettingScope[]
  /** a caveat worth surfacing, e.g. a deprecation */
  note?: string
}

export const SETTINGS_GROUPS = [
  'Model & responses',
  'Permissions',
  'Environment',
  'Git & attribution',
  'Sessions & cleanup',
  'MCP approvals',
  'Interface',
] as const

export const SETTINGS_CATALOG: readonly SettingDef[] = [
  // ---- Model & responses ----
  {
    key: 'model',
    title: 'Model',
    description: 'Which model Claude Code runs by default.',
    type: 'string',
    group: 'Model & responses',
    suggestions: ['opus', 'sonnet', 'haiku'],
    placeholder: 'sonnet, opus, or a full id like claude-sonnet-4-6',
  },
  {
    key: 'outputStyle',
    title: 'Output style',
    description: 'The voice and shape of Claude’s replies.',
    type: 'enum',
    group: 'Model & responses',
    options: [
      { value: 'Default' },
      { value: 'Proactive' },
      { value: 'Explanatory' },
      { value: 'Learning' },
    ],
  },
  {
    key: 'effortLevel',
    title: 'Effort level',
    description: 'How much reasoning Claude spends, kept across sessions.',
    type: 'enum',
    group: 'Model & responses',
    options: [
      { value: 'low', hint: 'fastest, cheapest' },
      { value: 'medium' },
      { value: 'high' },
      { value: 'xhigh', hint: 'deepest, slowest' },
    ],
  },
  {
    key: 'alwaysThinkingEnabled',
    title: 'Always think',
    description: 'Turn on extended thinking for every turn.',
    type: 'boolean',
    group: 'Model & responses',
  },
  {
    key: 'language',
    title: 'Response language',
    description: 'Ask Claude to reply in a specific language.',
    type: 'string',
    group: 'Model & responses',
    placeholder: 'French, Spanish, 日本語…',
  },

  // ---- Permissions ----
  {
    key: 'permissions.defaultMode',
    title: 'Default permission mode',
    description: 'How Claude asks before using tools at the start of a session.',
    type: 'enum',
    group: 'Permissions',
    options: [
      { value: 'default', hint: 'ask before each tool' },
      { value: 'acceptEdits', hint: 'auto-accept file edits' },
      { value: 'plan', hint: 'read-only, plan first' },
      { value: 'auto', hint: 'run freely with safety checks' },
      { value: 'dontAsk', hint: 'only pre-approved tools' },
      { value: 'bypassPermissions', hint: 'no prompts — sandboxes only' },
    ],
  },
  {
    key: 'permissions.allow',
    title: 'Always allow',
    description: 'Tool patterns Claude may use without asking.',
    type: 'stringList',
    group: 'Permissions',
    placeholder: 'Bash(npm run build)',
  },
  {
    key: 'permissions.ask',
    title: 'Always confirm',
    description: 'Tool patterns that should always prompt first.',
    type: 'stringList',
    group: 'Permissions',
    placeholder: 'Bash(git push)',
  },
  {
    key: 'permissions.deny',
    title: 'Always block',
    description: 'Tool patterns Claude may never use.',
    type: 'stringList',
    group: 'Permissions',
    placeholder: 'Read(./.env)',
  },
  {
    key: 'permissions.additionalDirectories',
    title: 'Extra directories',
    description: 'Folders Claude may read and edit beyond the working directory.',
    type: 'stringList',
    group: 'Permissions',
    placeholder: '/absolute/path',
  },

  // ---- Environment ----
  {
    key: 'env',
    title: 'Environment variables',
    description: 'Variables applied to every Claude Code session.',
    type: 'stringMap',
    group: 'Environment',
  },

  // ---- Git & attribution ----
  {
    key: 'includeCoAuthoredBy',
    title: 'Co-authored-by trailer',
    description: 'Add Claude as a Co-Authored-By on commits and PRs.',
    type: 'boolean',
    group: 'Git & attribution',
    default: true,
    note: 'Deprecated — newer versions prefer the `attribution` setting.',
  },
  {
    key: 'includeGitInstructions',
    title: 'Git instructions',
    description: 'Include git workflow guidance in Claude’s system prompt.',
    type: 'boolean',
    group: 'Git & attribution',
    default: true,
  },

  // ---- Sessions & cleanup ----
  {
    key: 'cleanupPeriodDays',
    title: 'Keep sessions for',
    description: 'Days before old session transcripts are deleted.',
    type: 'number',
    group: 'Sessions & cleanup',
    default: 30,
    placeholder: '30',
  },
  {
    key: 'autoCompactEnabled',
    title: 'Auto-compact',
    description: 'Summarize the conversation as it nears the context limit.',
    type: 'boolean',
    group: 'Sessions & cleanup',
    default: true,
  },
  {
    key: 'fileCheckpointingEnabled',
    title: 'File checkpoints',
    description: 'Snapshot files before edits so /rewind can undo them.',
    type: 'boolean',
    group: 'Sessions & cleanup',
    default: true,
  },

  // ---- MCP approvals ----
  {
    key: 'enableAllProjectMcpServers',
    title: 'Trust project MCP servers',
    description: 'Auto-approve every server defined in the project’s .mcp.json.',
    type: 'boolean',
    group: 'MCP approvals',
  },
  {
    key: 'enabledMcpjsonServers',
    title: 'Approved .mcp.json servers',
    description: 'Specific .mcp.json servers to pre-approve by name.',
    type: 'stringList',
    group: 'MCP approvals',
    placeholder: 'server-name',
  },
  {
    key: 'disabledMcpjsonServers',
    title: 'Rejected .mcp.json servers',
    description: 'Specific .mcp.json servers to refuse by name.',
    type: 'stringList',
    group: 'MCP approvals',
    placeholder: 'server-name',
  },

  // ---- Interface ----
  {
    key: 'theme',
    title: 'Theme',
    description: 'Light or dark UI in the desktop and IDE apps.',
    type: 'enum',
    group: 'Interface',
    options: [{ value: 'dark' }, { value: 'light' }, { value: 'auto' }],
  },
  {
    key: 'editorMode',
    title: 'Editor keys',
    description: 'Use normal or vim key bindings in the prompt.',
    type: 'enum',
    group: 'Interface',
    options: [{ value: 'normal' }, { value: 'vim' }],
  },
  {
    key: 'preferredNotifChannel',
    title: 'Notifications',
    description: 'How Claude Code gets your attention when it needs you.',
    type: 'enum',
    group: 'Interface',
    default: 'auto',
    options: [
      { value: 'auto' },
      { value: 'terminal_bell' },
      { value: 'iterm2' },
      { value: 'kitty' },
      { value: 'ghostty' },
      { value: 'notifications_disabled', label: 'off' },
    ],
  },
  {
    key: 'verbose',
    title: 'Verbose logging',
    description: 'Show full command output and extra diagnostics.',
    type: 'boolean',
    group: 'Interface',
  },
  {
    key: 'prefersReducedMotion',
    title: 'Reduce motion',
    description: 'Trim UI animations for comfort and accessibility.',
    type: 'boolean',
    group: 'Interface',
  },
]

/** The catalog entries valid for a scope, grouped in `SETTINGS_GROUPS` order. */
export function catalogByGroup(
  scope: SettingScope,
  query = '',
): { group: string; defs: SettingDef[] }[] {
  const q = query.trim().toLowerCase()
  const matches = SETTINGS_CATALOG.filter((d) => {
    if (d.scopes && !d.scopes.includes(scope)) return false
    if (q === '') return true
    return [d.key, d.title, d.description].join(' ').toLowerCase().includes(q)
  })
  return SETTINGS_GROUPS.map((group) => ({
    group,
    defs: matches.filter((d) => d.group === group),
  })).filter((g) => g.defs.length > 0)
}

/** Every dotted key the catalog owns — used to split "known" from "raw" leaves. */
export function catalogKeys(): Set<string> {
  return new Set(SETTINGS_CATALOG.map((d) => d.key))
}
