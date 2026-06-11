import { describe, expect, it } from 'vitest'
import { detectCli, runCommand } from '../src/cli.js'

describe('runCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runCommand('node', ['-e', "console.log('hi')"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hi')
    expect(result.command).toBe(`node -e console.log('hi')`)
  })

  it('captures stderr and a non-zero exit code without throwing', async () => {
    const result = await runCommand('node', ['-e', "console.error('boom'); process.exit(3)"])
    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('boom')
  })

  it('throws for a missing binary', async () => {
    await expect(runCommand('definitely-not-a-real-binary-xyz', [])).rejects.toThrow()
  })

  it('handles outputs larger than 1MB', async () => {
    const result = await runCommand('node', [
      '-e',
      "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBe(2 * 1024 * 1024)
  })
})

describe('detectCli', () => {
  it('reports found=false for a missing binary', async () => {
    expect(await detectCli('definitely-not-a-real-binary-xyz')).toEqual({ found: false })
  })

  it('reports found=true with a version for an existing binary', async () => {
    const info = await detectCli('node')
    expect(info.found).toBe(true)
    expect(info.version).toMatch(/^v\d+/)
  })
})
