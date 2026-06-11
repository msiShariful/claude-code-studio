import { describe, expect, it } from 'vitest'
import { createToken } from '../src/config.js'
import { browserCommand } from '../src/open-browser.js'

describe('createToken', () => {
  it('produces unique 64-char hex tokens', () => {
    const a = createToken()
    const b = createToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('browserCommand', () => {
  it('maps each platform to its opener', () => {
    const url = 'http://127.0.0.1:1234/#token=abc'
    expect(browserCommand(url, 'darwin')).toEqual({ bin: 'open', args: [url] })
    expect(browserCommand(url, 'linux')).toEqual({ bin: 'xdg-open', args: [url] })
    expect(browserCommand(url, 'win32')).toEqual({
      bin: 'cmd',
      args: ['/c', 'start', '', url],
    })
  })
})
