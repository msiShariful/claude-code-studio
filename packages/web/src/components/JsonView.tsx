import { useMemo, useState } from 'react'

export interface FoldRegion {
  /** 0-based line index of the line carrying the opening bracket */
  start: number
  /** 0-based line index of the line carrying the matching closing bracket */
  end: number
  /** the opening bracket character */
  open: '{' | '['
}

const CLOSE: Record<FoldRegion['open'], '}' | ']'> = { '{': '}', '[': ']' }

/**
 * Find every multi-line `{…}` / `[…]` region in raw text by bracket matching.
 * Brackets inside double-quoted strings are ignored (with backslash escapes),
 * so it works on the actual file text without needing valid JSON. Single-line
 * pairs are skipped — there is nothing to fold. When two brackets open on the
 * same line, the outermost (widest) region wins for that line's toggle.
 */
export function foldRegions(raw: string): FoldRegion[] {
  const stack: { open: FoldRegion['open']; line: number }[] = []
  const regions: FoldRegion[] = []
  let line = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\n') {
      line++
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      stack.push({ open: ch, line })
    } else if (ch === '}' || ch === ']') {
      const top = stack.pop()
      if (top && top.line < line) {
        regions.push({ start: top.line, end: line, open: top.open })
      }
    }
  }
  return regions
}

/** For each start line, keep the widest region so its toggle folds the most. */
function regionByStart(regions: FoldRegion[]): Map<number, FoldRegion> {
  const map = new Map<number, FoldRegion>()
  for (const r of regions) {
    const existing = map.get(r.start)
    if (!existing || r.end > existing.end) map.set(r.start, r)
  }
  return map
}

export function JsonView({ raw }: { raw: string }) {
  const lines = useMemo(() => raw.split('\n'), [raw])
  const starts = useMemo(() => regionByStart(foldRegions(raw)), [raw])
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())

  function toggle(start: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })
  }

  // A line is hidden when any collapsed region strictly contains it.
  function hidden(i: number): boolean {
    for (const start of collapsed) {
      const r = starts.get(start)
      if (r && r.start < i && i <= r.end) return true
    }
    return false
  }

  const gutterWidth = String(lines.length).length

  return (
    <pre className="code json-view">
      {lines.map((text, i) => {
        if (hidden(i)) return null
        const region = starts.get(i)
        const isCollapsed = region != null && collapsed.has(i)
        return (
          <div className="json-line" key={i}>
            <span className="ln-gutter">
              {region ? (
                <button
                  type="button"
                  className="fold"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? `Expand lines from ${i + 1}` : `Collapse lines from ${i + 1}`}
                  onClick={() => toggle(i)}
                >
                  {isCollapsed ? '⊞' : '⊟'}
                </button>
              ) : (
                <span className="fold-spacer" />
              )}
              <span className="ln-num" style={{ width: `${gutterWidth}ch` }}>
                {i + 1}
              </span>
            </span>
            <span className="ln-text">
              {isCollapsed && region ? (
                <>
                  {text}
                  <span className="fold-ellipsis"> ⋯ {CLOSE[region.open]}</span>
                </>
              ) : (
                text
              )}
            </span>
          </div>
        )
      })}
    </pre>
  )
}
