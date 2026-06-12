#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createToken } from './config.js'
import { openBrowser } from './open-browser.js'
import { buildServer } from './server.js'

function findWebRoot(): string {
  // '../web-dist' is the published-package layout (assets packed next to dist/);
  // '../../web/dist' is the monorepo dev layout.
  const candidates = ['../web-dist', '../../web/dist'].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  )
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? candidates[0]
}

async function main(): Promise<void> {
  const token = createToken()
  const app = buildServer({ token, webRoot: findWebRoot() })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const url = `${address}/#token=${token}`
  console.log(`\n  Claude Code Studio is running:\n\n    ${url}\n`)
  const opened = await openBrowser(url)
  if (!opened) {
    console.log('  Could not open a browser automatically — open the URL above manually.\n')
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
