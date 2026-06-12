import { build } from 'esbuild'

// Inline the workspace-internal core (and its only dependency, diff) so the
// published package needs no unpublished workspace deps. Fastify stays a
// normal registry dependency.
await build({
  entryPoints: ['src/bin.ts', 'src/index.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['fastify', '@fastify/static'],
  logLevel: 'info',
})
