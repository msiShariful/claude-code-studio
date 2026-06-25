import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  blocksData,
  calcCost,
  dailyData,
  getPrice,
  heatmapData,
  historyData,
  loadAll,
  modelsData,
  statsData,
} from '../src/index.js'

const SONNET = 'claude-sonnet-4-6'
const OPUS = 'claude-opus-4-6-20260514'
const M = 1_000_000

function line(o: unknown) {
  return JSON.stringify(o) + '\n'
}
function assistant(ts: string, model: string, input: number, reqId: string, parentUuid?: string) {
  return line({
    type: 'assistant',
    timestamp: ts,
    requestId: reqId,
    parentUuid,
    message: { model, id: reqId, usage: { input_tokens: input } },
  })
}

// One temp projects dir with two projects / two sessions.
const dir = mkdtempSync(join(tmpdir(), 'ccs-usage-'))
mkdirSync(join(dir, 'proj-one'))
mkdirSync(join(dir, 'proj-two'))
writeFileSync(
  join(dir, 'proj-one', 'sessA.jsonl'),
  assistant('2026-06-01T10:00:00Z', SONNET, M, 'r1') +
    assistant('2026-06-01T10:00:00Z', SONNET, M, 'r1') + // duplicate requestId → deduped
    assistant('2026-06-02T10:00:00Z', OPUS, M, 'r2'),
)
writeFileSync(
  join(dir, 'proj-two', 'sessB.jsonl'),
  line({
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-06-02T11:00:00Z',
    cwd: '/work/proj-two',
    message: { content: 'Refactor the parser' },
  }) + assistant('2026-06-02T11:00:01Z', SONNET, M / 2, 'r3', 'u1'),
)

afterAll(() => {
  /* tmp dir is left for the OS to reap; nothing to clean between runs */
})

describe('pricing', () => {
  it('prices by model family and zeroes unknown models', () => {
    expect(calcCost({ input_tokens: M }, SONNET)).toBeCloseTo(3.0)
    expect(calcCost({ input_tokens: M }, OPUS)).toBeCloseTo(15.0)
    expect(getPrice('some-future-model')).toBeNull()
    expect(calcCost({ input_tokens: M }, 'some-future-model')).toBe(0)
  })
})

describe('parser + aggregations', () => {
  const records = loadAll(dir)

  it('dedupes retried requests by id', () => {
    // r1 appears twice in the file but counts once → 3 records, not 4
    expect(records.filter((r) => r.session === 'sessA')).toHaveLength(2)
  })

  it('rolls up all-time stats across projects and sessions', () => {
    const s = statsData(records)
    expect(s.cost).toBeCloseTo(19.5) // 3 + 15 + 1.5
    expect(s.input).toBe(2.5 * M)
    expect(s.project_count).toBe(2)
    expect(s.session_count).toBe(2)
    expect(s.models).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6']) // suffix stripped, sorted
  })

  it('computes per-model share', () => {
    const m = modelsData(records)
    expect(m.total_cost).toBeCloseTo(19.5)
    const opus = m.models.find((x) => x.model === 'claude-opus-4-6')!
    expect(opus.share).toBeCloseTo(15 / 19.5)
  })

  it('buckets daily spend within an explicit range', () => {
    const d = dailyData(records, { since: '2026-06-01', until: '2026-06-02' })
    expect(d.days).toHaveLength(2)
    expect(d.days[0]).toMatchObject({ date: '2026-06-01', cost: 3 })
    expect(d.days[1].cost).toBeCloseTo(16.5) // opus 15 + sonnet 1.5
  })

  it('groups 5-hour billing windows', () => {
    const blocks = blocksData(records)
    // 06-01 stands alone; the two 06-02 turns are 1h apart → one shared window
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.active === false)).toBe(true)
  })

  it('zero-fills the heatmap to a fixed window length', () => {
    const cells = heatmapData(records, 84)
    expect(cells).toHaveLength(84)
    expect(cells.some((c) => c.cost > 0)).toBe(true)
  })

  it('reads prompt history and attributes cost to the prompt', () => {
    const rows = historyData(dir)
    const row = rows.find((r) => r.prompt === 'Refactor the parser')!
    expect(row).toBeDefined()
    expect(row.project).toBe('proj-two')
    expect(row.cost).toBeCloseTo(1.5) // the child assistant turn's cost
  })
})
