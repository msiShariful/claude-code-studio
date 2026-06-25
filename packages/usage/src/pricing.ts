// Pricing per million tokens (April 2026 published Anthropic rates). Edit here if
// rates change — every aggregation reads from this map. No network: a local tool
// should never phone home to price your own logs.

export interface ModelRate {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export const PRICING: Record<'opus' | 'sonnet' | 'haiku', ModelRate> = {
  opus: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
}

/** Rates are quoted as of this date; surfaced in the UI so figures are honest. */
export const PRICING_AS_OF = 'April 2026'

export interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function getPrice(model = ''): ModelRate | null {
  const m = model.toLowerCase()
  if (m.includes('opus')) return PRICING.opus
  if (m.includes('sonnet')) return PRICING.sonnet
  if (m.includes('haiku')) return PRICING.haiku
  return null
}

/** Cost in USD for one assistant turn's usage. Unknown models price to 0. */
export function calcCost(usage: RawUsage, model: string): number {
  const p = getPrice(model)
  if (!p) return 0
  const M = 1_000_000
  return (
    ((usage.input_tokens ?? 0) * p.input) / M +
    ((usage.output_tokens ?? 0) * p.output) / M +
    ((usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) / M +
    ((usage.cache_read_input_tokens ?? 0) * p.cacheRead) / M
  )
}
