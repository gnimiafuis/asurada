import type { AIMessageChunk, ToolMessage } from '@langchain/core/messages'
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

        // Load full schedule from DB (gets latest prompt, checks enabled)
        const scheduleResult = await query(
          'SELECT thread_id, type, prompt, enabled FROM schedules WHERE id = $1',
          [job.data.scheduleId],
        )
        const schedule = scheduleResult.rows[0] as
          | { thread_id?: string; type?: string; prompt?: string; enabled?: boolean }
          | undefined

        if (!schedule || !schedule.enabled) {
          logger.warn(
            { scheduleId: job.data.scheduleId },
            'schedule not found or disabled — skipping',
          )
          return
        }

        const threadId = schedule.thread_id
        const prompt = schedule.prompt

        logger.info(
          { threadId, type: schedule.type, prompt: prompt?.slice(0, 80) },
          'running scheduled agent',
        )

        // Stream the agent's response and push each event via Redis pub/sub
        const { publishThreadEvent } = await import('./pubsub.js')
        const { extractChunk } = await import('../agent/extract.js')

        await publishThreadEvent(threadId as string, 'stream-start', {})

        // Stream metrics: TTFT + TPS (all durations logged in seconds)
        const startTime = Date.now()
        let firstTokenTime: number | null = null
        let chunkCount = 0

        const stream = await agent.stream(
          { messages: [new lcMessages.HumanMessage(prompt as string)] },
          { configurable: { thread_id: threadId }, streamMode: 'messages', recursionLimit: 25 },
        )

        for await (const [chunk] of stream) {
          const type = chunk._getType()

          if (type === 'tool') {
            const toolName = (chunk as ToolMessage).name ?? 'tool'
            const raw = (chunk as ToolMessage).content
            const resultText =
              typeof raw === 'string' ? raw.slice(0, 2000) : JSON.stringify(raw).slice(0, 2000)
            await publishThreadEvent(threadId as string, 'tool-result', {
              name: toolName,
              content: resultText,
            })
            continue
          }

          if (type !== 'ai') continue

          // Tool calls
          const aiChunk = chunk as AIMessageChunk
          for (const tc of aiChunk.tool_call_chunks ?? []) {
            if (tc.name) {
              await publishThreadEvent(threadId as string, 'tool-call', {
                name: tc.name,
                args: tc.args ?? '',
              })
            }
          }

          const { thinking, content } = extractChunk(chunk)
          if (thinking || content) {
            if (firstTokenTime === null) firstTokenTime = Date.now()
            chunkCount++
          }
          if (thinking) {
            await publishThreadEvent(threadId as string, 'thinking-token', { text: thinking })
          }
          if (content) {
            await publishThreadEvent(threadId as string, 'token', { text: content })
          }
        }

        // Log stream metrics — all durations in seconds
        const toSec = (ms: number) => +(ms / 1000).toFixed(2)
        const genMs = firstTokenTime !== null ? Date.now() - firstTokenTime : 0
        logger.info(
          {
            ttftSec: firstTokenTime !== null ? toSec(firstTokenTime - startTime) : null,
            tps: genMs > 0 ? +(chunkCount / (genMs / 1000)).toFixed(1) : 0,
            chunks: chunkCount,
            totalSec: toSec(Date.now() - startTime),
            scheduleId: job.data.scheduleId,
            threadId,
          },
          '📈 stream metrics',
        )

        await publishThreadEvent(threadId as string, 'stream-done', {})

        // Update last_run
        await query('UPDATE schedules SET last_run = NOW() WHERE id = $1', [job.data.scheduleId])

        // One-time schedules auto-delete after firing
        if (schedule.type === 'once') {
          await query('DELETE FROM schedules WHERE id = $1', [job.data.scheduleId])
          logger.info({ scheduleId: job.data.scheduleId }, '⏰ one-time schedule fired + deleted')
        } else {
          logger.info({ scheduleId: job.data.scheduleId }, '⏰ scheduled run complete')
        }

        // Notify schedule changes (auto-delete, last_run, etc.)
        await publishThreadEvent(threadId as string, 'thread-updated', {
          scheduleId: job.data.scheduleId,
        })
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

export async function closeWorker(): Promise<void> {
  await worker?.close()
}

export async function closeQueue(): Promise<void> {
  await closeWorker()
  await defaultQueue?.close()
  connection?.disconnect()
}
