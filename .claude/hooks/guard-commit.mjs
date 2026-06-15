#!/usr/bin/env node
// PreToolUse(Bash) guard. Blocks any `git commit` whose message carries AI
// attribution — this project's hard rule is plain, user-only commits with no
// "Co-Authored-By: Claude", no "Generated with Claude", no robot emoji.
// Catches both `-m "…"` and heredoc (`-F -`) forms, since the whole command
// string (including the heredoc body) is in tool_input.command.
//
// Blocks by exiting 2 with an explanation on stderr (Claude sees it and adjusts).

import { readFileSync } from 'node:fs'

let data = {}
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  process.exit(0) // unparseable input → don't interfere
}

if (data.tool_name !== 'Bash') process.exit(0)
const cmd = data.tool_input?.command ?? ''
if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) process.exit(0)

const banned = [
  /co-authored-by:\s*claude/i,
  /co-authored-by:[^\n]*anthropic/i,
  /generated with[^\n]*claude/i,
  /generated with \[?claude code/i,
  /\u{1F916}/u, // 🤖
]

if (banned.some((re) => re.test(cmd))) {
  console.error(
    'Commit blocked: this project forbids AI attribution in commit messages — ' +
      'no "Co-Authored-By: Claude", no "Generated with Claude", no 🤖. ' +
      'Remove the trailer and commit again as the user only (plain git commit).',
  )
  process.exit(2)
}

process.exit(0)
