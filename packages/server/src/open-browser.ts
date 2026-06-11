import { runCommand } from '@claude-code-studio/core'

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { bin: string; args: string[] } {
  if (platform === 'darwin') return { bin: 'open', args: [url] }
  // cmd.exe reinterprets metacharacters (notably &) inside arguments; the
  // launch URL must stay free of them. /#token=<hex> is safe today.
  if (platform === 'win32') return { bin: 'cmd', args: ['/c', 'start', '', url] }
  return { bin: 'xdg-open', args: [url] }
}

/** Best-effort: returns false instead of throwing when no opener is available. */
export async function openBrowser(url: string): Promise<boolean> {
  const { bin, args } = browserCommand(url)
  try {
    const result = await runCommand(bin, args, { timeoutMs: 5_000 })
    return result.exitCode === 0
  } catch {
    return false
  }
}
