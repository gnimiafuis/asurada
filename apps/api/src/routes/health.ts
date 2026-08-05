import { Hono } from 'hono'
import { pgPool } from '../lib/postgres.js'
import { redis } from '../lib/redis.js'

export const health = new Hono()

health.get('/health', async (c) => {
  const checks = { api: true, postgres: false, redis: false }

  try {
    await pgPool.query('SELECT 1')
    checks.postgres = true
  } catch {
    // swallow — reported below
  }

  try {
    if (redis.isOpen) {
      await redis.ping()
      checks.redis = true
    }
  } catch {
    // swallow
  }

  const ok = Object.values(checks).every(Boolean)
  return c.json({ status: ok ? 'ok' : 'degraded', checks }, ok ? 200 : 503)
})
