import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CliRunResult {
  /** The exact command run, for verbatim error reporting in the UI */
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

/** Injectable command runner so callers (and tests) can substitute runCommand. */
export type CliRunner = (
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; maxBuffer?: number },
) => Promise<CliRunResult>

/**
 * Runs a binary via execFile (never a shell — arguments cannot be injected).
 * Non-zero exit codes resolve normally; missing binaries and timeouts throw.
 */
export async function runCommand(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CliRunResult> {
  const command = [bin, ...args].join(' ')
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    })
    return { command, exitCode: 0, stdout, stderr }
  } catch (err) {
    const e = err as Error & { code?: number | string; stdout?: string; stderr?: string }
    // e.code is a number only for normal process exits (e.g. exit(3)).
    // Timeouts (e.code === null, e.killed === true) and missing binaries
    // (e.code === 'ENOENT') both fail this guard and are re-thrown.
    if (typeof e.code === 'number') {
      return { command, exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
    throw err
  }
}

export interface CliInfo {
  found: boolean
  version?: string
}

/** Detects the Claude Code CLI (or any binary) by running `<bin> --version`. */
export async function detectCli(bin = 'claude'): Promise<CliInfo> {
  try {
    const result = await runCommand(bin, ['--version'])
    if (result.exitCode !== 0) return { found: false }
    return { found: true, version: result.stdout.trim() }
  } catch {
    return { found: false }
  }
}
