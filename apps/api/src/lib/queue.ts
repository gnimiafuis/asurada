import { Queue, Worker } from 'bullmq'
import { Redis as RedisClient } from 'ioredis'
import type { Logger } from './logger.js'

const QUEUE_NAME = 'default'

let connection: RedisClient | null = null
let defaultQueue: Queue | null = null
let worker: Worker | null = null

function getConnection(): RedisClient {
  if (!connection) {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
    connection = new RedisClient({
      host: url.hostname,
      port: Number(url.port) || 6379,
      maxRetriesPerRequest: null,
    })
  }
  return connection
}

export function getQueue(): Queue {
  if (!defaultQueue) {
    defaultQueue = new Queue(QUEUE_NAME, { connection: getConnection() })
  }
  return defaultQueue
}

export function startWorker(logger: Logger): Worker {
  if (worker) return worker
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'processing job')
    },
    { connection: getConnection() },
  )
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'job completed')
  })
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'job failed')
  })
  return worker
}

export async function closeQueue(): Promise<void> {
  await worker?.close()
  await defaultQueue?.close()
  connection?.disconnect()
}
