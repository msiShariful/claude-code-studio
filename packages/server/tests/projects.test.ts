import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auth, fixture } from './helpers.js'

describe('GET /api/projects', () => {
  it('rejects requests without the bearer token', async () => {
    const { app } = await fixture()
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('returns an empty list when ~/.claude.json does not exist', async () => {
    const { app } = await fixture()
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ projects: [] })
  })

  it('lists known projects with basename and on-disk existence', async () => {
    const { app, home, globalPaths } = await fixture()
    const real = join(home, 'real-project')
    await mkdir(real, { recursive: true })
    await writeFile(
      globalPaths.claudeJson,
      JSON.stringify({ projects: { [real]: {}, '/nope/gone': {} } }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.json()).toEqual({
      projects: [
        { dir: real, name: 'real-project', exists: true },
        { dir: '/nope/gone', name: 'gone', exists: false },
      ],
    })
  })

  it('merges extras, deduplicating against known projects and each other', async () => {
    const { app, home, globalPaths } = await fixture()
    const known = join(home, 'known')
    const extraDir = join(home, 'extra')
    await mkdir(known, { recursive: true })
    await mkdir(extraDir, { recursive: true })
    await writeFile(globalPaths.claudeJson, JSON.stringify({ projects: { [known]: {} } }))
    const extra = encodeURIComponent(`${known},${extraDir},${extraDir}`)
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects?extra=${extra}`,
      headers: auth,
    })
    expect(res.json()).toEqual({
      projects: [
        { dir: known, name: 'known', exists: true },
        { dir: extraDir, name: 'extra', exists: true },
      ],
    })
  })

  it('treats a malformed projects key as empty', async () => {
    const { app, globalPaths } = await fixture()
    await writeFile(globalPaths.claudeJson, JSON.stringify({ projects: 'oops' }))
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(res.json()).toEqual({ projects: [] })
  })
})
