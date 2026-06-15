#!/usr/bin/env node
// Status line: "cc-studio v<version>  ·  ⎇ <branch>  ·  <model>".
// Reads the Claude Code status JSON on stdin; fully defensive so a failure
// prints a minimal line and never errors the session.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let input = {}
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  /* ignore */
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let version = ''
try {
  version = JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).version
} catch {
  /* ignore */
}

const cwd = input.workspace?.current_dir || input.cwd || root
let branch = ''
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim()
} catch {
  /* ignore */
}

const model = input.model?.display_name || ''
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const accent = (s) => `\x1b[33m${s}\x1b[0m`

const parts = [
  accent('cc-studio') + (version ? dim(` v${version}`) : ''),
  branch ? dim(`⎇ ${branch}`) : '',
  model ? dim(model) : '',
].filter(Boolean)

process.stdout.write(parts.join(dim('  ·  ')))
