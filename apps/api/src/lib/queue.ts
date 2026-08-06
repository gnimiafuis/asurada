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

/**
 * Start the BullMQ worker. Handles scheduled agent runs.
 * The agent module is imported lazily to avoid circular dependencies
 * and to ensure the checkpointer is ready.
 */
export function startWorker(logger: Logger): Worker {
  if (worker) return worker

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // Scheduled agent run
      if (job.data?.scheduleId) {
        logger.info(
          { jobId: job.id, scheduleId: job.data.scheduleId },
          '⏰ scheduled run triggered',
        )

        // Lazy import to avoid loading the full agent stack at worker init
        const { messages: lcMessages } = await import('../agent/graph.js')
        const { buildAgent } = await import('../agent/graph.js')
        const { getCheckpointer, setupCheckpointer } = await import('./checkpointer.js')
        const { env } = await import('../env.js')
        const { query } = await import('./postgres.js')

        await setupCheckpointer()
        const agent = buildAgent(getCheckpointer(), {
          TAVILY_API_KEY: env.TAVILY_API_KEY,
          EXA_API_KEY: env.EXA_API_KEY,
          FIRECRAWL_API_KEY: env.FIRECRAWL_API_KEY,
        })

        const threadId = job.data.threadId ?? (await getThreadIdForSchedule(job.data.scheduleId))
        const prompt = job.data.prompt ?? (await getPromptForSchedule(job.data.scheduleId))

        if (!threadId || !prompt) {
          logger.warn({ scheduleId: job.data.scheduleId }, 'schedule not found or missing data')
          return
        }

        logger.info({ threadId, prompt: prompt.slice(0, 80) }, 'running scheduled agent')

        await agent.invoke(
          { messages: [new lcMessages.HumanMessage(prompt)] },
          { configurable: { thread_id: threadId }, recursionLimit: 10 },
        )

        // Update last_run
        await query('UPDATE schedules SET last_run = NOW() WHERE id = $1', [job.data.scheduleId])
        logger.info({ scheduleId: job.data.scheduleId }, '⏰ scheduled run complete')
        return
      }

      // Default handler for other jobs
      logger.info({ jobId: job.id, name: job.name }, 'processing job')
    },
    { connection: getConnection() },
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'job completed')
  })
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err: err.message }, 'job failed')
  })
  return worker
}

async function getThreadIdForSchedule(scheduleId: string): Promise<string | null> {
  const { query } = await import('./postgres.js')
  const result = await query('SELECT thread_id FROM schedules WHERE id = $1 AND enabled = true', [
    scheduleId,
  ])
  return (result.rows[0] as { thread_id?: string } | undefined)?.thread_id ?? null
}

async function getPromptForSchedule(scheduleId: string): Promise<string | null> {
  const { query } = await import('./postgres.js')
  const result = await query('SELECT prompt FROM schedules WHERE id = $1 AND enabled = true', [
    scheduleId,
  ])
  return (result.rows[0] as { prompt?: string } | undefined)?.prompt ?? null
}

export async function closeWorker(): Promise<void> {
  await worker?.close()
}

export async function closeQueue(): Promise<void> {
  await closeWorker()
  await defaultQueue?.close()
  connection?.disconnect()
}
