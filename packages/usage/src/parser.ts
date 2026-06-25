// Reads the JSONL session logs Claude Code writes to ~/.claude/projects/**.
// Pure reads, no side effects. The projects dir is always passed in (the server
// resolves it from the config paths) so this stays dependency-free and testable.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RawUsage } from './pricing.js'

export interface UsageRecord {
  usage: RawUsage
  model: string
  ts: string
  reqId: string | null
  project?: string
  session?: string
}

// Parse a single .jsonl session, keeping only assistant turns with usage.
// Dedupes by requestId so retried requests aren't double-billed.
export function parseSession(filePath: string): UsageRecord[] {
  const records: UsageRecord[] = []
  const seen = new Map<string, UsageRecord>()
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return records
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (obj.type !== 'assistant') continue
    const msg = (obj.message ?? {}) as Record<string, unknown>
    const usage = msg.usage as RawUsage | undefined
    if (!usage) continue

    const record: UsageRecord = {
      usage,
      model: (msg.model as string) ?? '',
      ts: (obj.timestamp as string) ?? '',
      reqId: (obj.requestId as string) ?? (msg.id as string) ?? null,
    }
    if (record.reqId) seen.set(record.reqId, record)
    else records.push(record)
  }
  records.push(...seen.values())
  return records
}

export function loadAll(projectsDir: string): UsageRecord[] {
  const all: UsageRecord[] = []
  if (!existsSync(projectsDir)) return all
  for (const projectName of readdirSync(projectsDir)) {
    const projectPath = join(projectsDir, projectName)
    if (!statSync(projectPath).isDirectory()) continue
    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith('.jsonl')) continue
      const session = file.replace('.jsonl', '')
      for (const r of parseSession(join(projectPath, file))) {
        r.project = projectName
        r.session = session
        all.push(r)
      }
    }
  }
  return all
}

export interface UserMessage {
  type: 'user'
  uuid: string | null
  content: unknown
  timestamp: string
  cwd: string
  project?: string
  session?: string
}
export interface AssistantMessage {
  type: 'assistant'
  parentUuid: string | null
  usage: RawUsage
  model: string
  project?: string
  session?: string
}
export type FullMessage = UserMessage | AssistantMessage

// Full parser used by prompt history — includes user prompts as well as usage.
export function parseSessionFull(filePath: string): FullMessage[] {
  const entries: FullMessage[] = []
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return entries
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const msg = (obj.message ?? {}) as Record<string, unknown>
    if (obj.type === 'user' && msg.content) {
      entries.push({
        type: 'user',
        uuid: (obj.uuid as string) ?? null,
        content: msg.content,
        timestamp: (obj.timestamp as string) ?? '',
        cwd: (obj.cwd as string) ?? '',
      })
    } else if (obj.type === 'assistant') {
      if (!msg.usage) continue
      entries.push({
        type: 'assistant',
        parentUuid: (obj.parentUuid as string) ?? null,
        usage: msg.usage as RawUsage,
        model: (msg.model as string) ?? '',
      })
    }
  }
  return entries
}

export function loadAllMessages(projectsDir: string): FullMessage[] {
  const all: FullMessage[] = []
  if (!existsSync(projectsDir)) return all
  for (const projectName of readdirSync(projectsDir)) {
    const projectPath = join(projectsDir, projectName)
    if (!statSync(projectPath).isDirectory()) continue
    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith('.jsonl')) continue
      const session = file.replace('.jsonl', '')
      for (const e of parseSessionFull(join(projectPath, file))) {
        e.project = projectName
        e.session = session
        all.push(e)
      }
    }
  }
  return all
}
