#!/usr/bin/env node
import { createToken } from './config.js'
import { openBrowser } from './open-browser.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const token = createToken()
  const app = buildServer({ token })
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
