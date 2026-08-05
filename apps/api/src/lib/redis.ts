import { type RedisClientType, createClient } from 'redis'
import { env } from '../env.js'

export const redis: RedisClientType = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
  },
})

redis.on('error', (err) => {
  console.error('Redis client error:', err)
})

let connecting: Promise<void> | null = null

export function connectRedis(): Promise<void> {
  if (redis.isOpen) return Promise.resolve()
  if (!connecting) {
    connecting = redis.connect().then(() => {
      connecting = null
    })
  }
  return connecting
}

export async function closeRedis(): Promise<void> {
  if (redis.isOpen) await redis.quit()
}
