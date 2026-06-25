// Date-range filter shared by the aggregations. `period` is the named alias
// (today/yesterday/week/month/all); since/until override it.

import type { UsageRecord } from './parser.js'

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all'

export interface Range {
  since?: string
  until?: string
}

export function filterByPeriod(
  records: UsageRecord[],
  period: string,
  { since, until }: Range = {},
): UsageRecord[] {
  if (since || until) {
    const lo = since ?? '0000-00-00'
    const hi = until ?? '9999-99-99'
    return records.filter((r) => {
      const d = r.ts.slice(0, 10)
      return d >= lo && d <= hi
    })
  }
  const now = Date.now()
  const day = 86_400_000
  const todayStr = new Date(now).toISOString().slice(0, 10)
  const yesterdayStr = new Date(now - day).toISOString().slice(0, 10)
  const weekAgo = new Date(now - 6 * day).toISOString().slice(0, 10)
  const monthAgo = new Date(now - 29 * day).toISOString().slice(0, 10)
  switch (period) {
    case 'today':
      return records.filter((r) => r.ts.startsWith(todayStr))
    case 'yesterday':
      return records.filter((r) => r.ts.startsWith(yesterdayStr))
    case 'week':
      return records.filter((r) => r.ts.slice(0, 10) >= weekAgo)
    case 'month':
      return records.filter((r) => r.ts.slice(0, 10) >= monthAgo)
    default:
      return records
  }
}

export function periodLabel(period: string, { since, until }: Range = {}): string {
  if (since && until) return `${since} → ${until}`
  if (since) return `since ${since}`
  if (until) return `until ${until}`
  switch (period) {
    case 'today':
      return 'Today'
    case 'yesterday':
      return 'Yesterday'
    case 'week':
      return 'Last 7 days'
    case 'month':
      return 'Last 30 days'
    default:
      return 'All time'
  }
}
