import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Localhost hardening, on every request:
 *  - Host header must be a loopback name (blocks DNS rebinding).
 *  - An Origin header, when present, must also be loopback (no CORS).
 * Token auth is NOT handled here — it is a scoped hook bound to the API
 * route context (see requireBearerToken), so it cannot be bypassed by
 * raw-URL encoding tricks like /%61pi/health (find-my-way decodes for
 * route matching; raw req.url string checks do not).
 */
export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const hostname = req.hostname
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
  })
}

/** Scoped onRequest hook: register inside the API plugin context only. */
export function requireBearerToken(token: string) {
  const expected = `Bearer ${token}`
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers.authorization !== expected) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  }
}

function safeOriginHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}
