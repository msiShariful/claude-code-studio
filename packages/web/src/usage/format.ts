// Formatting + the model-family palette for the Usage area. Figures are the hero
// here, so these are deliberately precise (money to 4dp, tokens compact).

export function fmtUSD(n: number | null | undefined, dp = 4): string {
  return '$' + (n ?? 0).toFixed(dp)
}

/** Money that stays readable across magnitudes — cents-precise when small. */
export function fmtUSDCompact(n: number | null | undefined): string {
  const v = n ?? 0
  if (v >= 1000) return '$' + v.toFixed(0)
  if (v >= 100) return '$' + v.toFixed(2)
  return '$' + v.toFixed(4)
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

export function fmtPct(n: number): string {
  return n.toFixed(0) + '%'
}

const MODEL_COLORS: Record<string, string> = {
  opus: '#b18cff',
  sonnet: '#43c9bf',
  haiku: '#e0a45a',
}

/** A stable colour per model family; unknown models read as neutral. */
export function modelColor(model: string): string {
  const n = (model || '').toLowerCase()
  if (n.includes('opus')) return MODEL_COLORS.opus
  if (n.includes('sonnet')) return MODEL_COLORS.sonnet
  if (n.includes('haiku')) return MODEL_COLORS.haiku
  return '#8a8fa3'
}
