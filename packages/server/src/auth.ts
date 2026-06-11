import type { FastifyInstance } from 'fastify'

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

/**
 * Localhost hardening, on every request:
 *  - Host header must be 127.0.0.1 or localhost (blocks DNS rebinding).
 *  - An Origin header, when present, must also be one of those hosts (no CORS).
 *  - /api/* additionally requires the per-session bearer token.
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (req, reply) => {
    const hostname = (req.headers.host ?? '').split(':')[0]
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'forbidden_host' })
    }
    const origin = req.headers.origin
    if (origin) {
      const originHost = safeOriginHostname(origin)
      if (!originHost || !ALLOWED_HOSTNAMES.has(originHost)) {
        return reply.code(403).send({ error: 'forbidden_origin' })
      }
    }
    if (req.url.startsWith('/api/') && req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })
}

function safeOriginHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}
