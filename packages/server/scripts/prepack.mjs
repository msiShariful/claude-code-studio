import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
const target = join(pkgRoot, 'web-dist')

if (!existsSync(join(pkgRoot, 'dist', 'bin.js'))) {
  throw new Error('dist/bin.js is missing — run `npm run build` at the repo root before packing')
}
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error('packages/web/dist is missing — run `npm run build` at the repo root before packing')
}

rmSync(target, { recursive: true, force: true })
cpSync(webDist, target, { recursive: true })
console.log(`prepack: copied web assets into ${target}`)
