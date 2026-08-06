import { type RedisClientType, createClient } from 'redis'
import { env } from '../env.js'
import { logger } from './logger.js'

let publisher: RedisClientType | null = null
let publisherPromise: Promise<void> | null = null

/** Get the shared publisher client (lazy connect). */
export function getPublisher(): RedisClientType {
  if (!publisher) {
    publisher = createClient({ url: env.REDIS_URL })
    publisher.on('error', (err) => logger.error({ err: err.message }, 'redis publisher error'))
  }
  return publisher
}

/** Connect the publisher (idempotent). */
export function connectPublisher(): Promise<void> {
  if (!publisherPromise) {
    publisherPromise = getPublisher()
      .connect()
      .then(() => undefined)
  }
  return publisherPromise
}

/** Publish an event to a thread channel. */
export async function publishThreadEvent(
  threadId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const pub = getPublisher()
  if (!pub.isOpen) await pub.connect()
  await pub.publish(`thread:${threadId}`, JSON.stringify({ event, data, ts: Date.now() }))
}

/** Create a dedicated subscriber for a thread channel.
 *  Caller is responsible for disconnecting when done. */
export async function subscribeToThread(
  threadId: string,
  handler: (message: string) => void,
): Promise<RedisClientType> {
  const sub: RedisClientType = createClient({ url: env.REDIS_URL })
  sub.on('error', (err) => logger.error({ err: err.message }, 'redis subscriber error'))
  await sub.connect()
  await sub.subscribe(`thread:${threadId}`, handler)
  return sub
}

export async function closePublisher(): Promise<void> {
  if (publisher?.isOpen) await publisher.quit()
  publisher = null
  publisherPromise = null
}
