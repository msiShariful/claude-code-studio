// Pull a readable prompt out of a stored user message, skipping the synthetic
// system/tool envelopes Claude Code writes into the transcript. Ported from the
// source CLI's format.js (terminal coloring left behind).

const SYSTEM_PREFIXES = [
  '<local-command',
  '<bash-stdout',
  '<bash-input',
  '<bash-stderr',
  '<command-name',
  '<command-message',
  '<system-reminder',
  '<user-prompt',
  '<task-notification',
  '<task-update',
  '[Request interrupted',
  '[Image: source',
  '[Image source',
  'This session is being continued',
]

function isSystemText(t: string): boolean {
  return SYSTEM_PREFIXES.some((p) => t.startsWith(p))
}

interface TextBlock {
  type?: string
  text?: string
}

export function extractPromptText(content: unknown, maxLen = 60): string | null {
  let text: string
  if (typeof content === 'string') {
    if (isSystemText(content.trimStart())) return null
    text = content
  } else if (Array.isArray(content)) {
    const block = (content as TextBlock[]).find((b) => b.type === 'text')
    if (!block?.text) return null
    if (isSystemText(block.text.trimStart())) return null
    text = block.text
  } else {
    return null
  }
  text = text.replace(/\n+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text
}
