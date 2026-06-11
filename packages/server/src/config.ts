import { randomBytes } from 'node:crypto'

/** Per-session bearer token, delivered to the browser via the launch URL fragment. */
export function createToken(): string {
  return randomBytes(32).toString('hex')
}
