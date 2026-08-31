import {
  type AIMessageChunk,
  type BaseMessage,
  RemoveMessage,
  type ToolMessage,
} from '@langchain/core/messages'
import { Queue, Worker } from 'bullmq'
import { Redis as RedisClient } from 'ioredis'
import type { Logger } from './logger.js'

const QUEUE_NAME = 'default'
const CHAT_JOB_PREFIX = 'chat-'
const CHAT_TIMEOUT_MS = 240_000

let connection: RedisClient | null = null
let defaultQueue: Queue | null = null
let worker: Worker | null = null
let controlSub: RedisClient | null = null

// jobId → AbortController for in-flight runs (cancel via Redis control channel)
const activeRuns = new Map<string, AbortController>()

// Parallel jobs per worker process. BullMQ's default is 1 — without this,
// one long deep-research run on thread A blocks EVERY other thread's
// messages and all scheduled fires (single-lane queue).
const WORKER_CONCURRENCY = 10

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

/** Deterministic per-thread jobId — also the one-active-run-per-thread guard key. */
export function chatJobId(threadId: string): string {
  return `${CHAT_JOB_PREFIX}${threadId}`
}

/** Check whether a chat run is active/waiting for a thread (for the 409 guard). */
export async function hasActiveChatRun(threadId: string): Promise<boolean> {
  const job = await getQueue().getJob(chatJobId(threadId))
  if (!job) return false
  try {
    const state = await job.getState()
    return state === 'active' || state === 'waiting' || state === 'delayed'
  } catch {
    return false
  }
}

/* ─────────────────────────────────────────────────────────────
 * Agent singleton (built lazily once per process — both
 * scheduled and interactive runs share it)
 * ───────────────────────────────────────────────────────────── */
type Agent = Awaited<ReturnType<typeof import('../agent/graph.js')['buildAgent']>>
let agentPromise: Promise<Agent> | null = null

async function getAgent(): Promise<Agent> {
  if (!agentPromise) {
    agentPromise = (async () => {
      const { buildAgent } = await import('../agent/graph.js')
      const { getCheckpointer, setupCheckpointer } = await import('./checkpointer.js')
      const { env } = await import('../env.js')
      await setupCheckpointer()
      return buildAgent(getCheckpointer(), {
        TAVILY_API_KEY: env.TAVILY_API_KEY,
        EXA_API_KEY: env.EXA_API_KEY,
        FIRECRAWL_API_KEY: env.FIRECRAWL_API_KEY,
      })
    })()
  }
  return agentPromise
}

/**
 * Rewind a cancelled turn: remove everything from the last HumanMessage
 * onward (question + partial + tool intermediates) so the thread returns
 * to its pre-send state and the next message starts with clean context.
 */
async function rewindTurn(agent: Agent, threadId: string, logger: Logger): Promise<void> {
  try {
    const config = { configurable: { thread_id: threadId } }
    const state = await agent.getState(config)
    const msgs = (state.values?.messages ?? []) as BaseMessage[]

    let lastHumanIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?._getType() === 'human') {
        lastHumanIdx = i
        break
      }
    }
    if (lastHumanIdx === -1) return

    const removals = msgs
      .slice(lastHumanIdx)
      .filter((m) => typeof m.id === 'string')
      .map((m) => new RemoveMessage({ id: m.id as string }))

    if (removals.length > 0) {
      await agent.updateState(config, { messages: removals })
      logger.info({ threadId, removed: removals.length }, '⏪ cancelled turn rewound')
    }
  } catch (err) {
    logger.warn(
      { threadId, err: err instanceof Error ? err.message : String(err) },
      'rewind failed',
    )
  }
}

/* ─────────────────────────────────────────────────────────────
 * Shared agent stream → Redis events (used by BOTH chat and
 * scheduled runs). Publishes: tool-call, tool-result, thinking-start,
 * thinking-token, token. Caller handles stream-start/done lifecycle.
 * ───────────────────────────────────────────────────────────── */
async function streamAgentEvents(
  agent: Agent,
  opts: {
    threadId: string
    content: string
    deepResearch?: boolean
    signal?: AbortSignal
    metricsCtx: Record<string, unknown> // extra fields for the metrics log
  },
  logger: Logger,
): Promise<void> {
  const { publishThreadEvent } = await import('./pubsub.js')
  const { extractChunk } = await import('../agent/extract.js')
  const { messages: lcMessages } = await import('../agent/graph.js')

  const startTime = Date.now()
  let firstTokenTime: number | null = null
  let chunkCount = 0
  let firstThinking = true

  const stream = await agent.stream(
    { messages: [new lcMessages.HumanMessage(opts.content)] },
    {
      configurable: {
        thread_id: opts.threadId,
        ...(opts.deepResearch !== undefined ? { deep_research: opts.deepResearch } : {}),
      },
      streamMode: 'messages',
      recursionLimit: 25,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  )

  for await (const [chunk] of stream) {
    const type = chunk._getType()

    if (type === 'tool') {
      const toolName = (chunk as ToolMessage).name ?? 'tool'
      const raw = (chunk as ToolMessage).content
      const resultText =
        typeof raw === 'string' ? raw.slice(0, 2000) : JSON.stringify(raw).slice(0, 2000)
      await publishThreadEvent(opts.threadId, 'tool-result', {
        name: toolName,
        content: resultText,
      })
      firstThinking = true
      continue
    }

    if (type !== 'ai') continue

    const aiChunk = chunk as AIMessageChunk
    for (const tc of aiChunk.tool_call_chunks ?? []) {
      if (tc.name) {
        await publishThreadEvent(opts.threadId, 'tool-call', {
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
      await publishThreadEvent(opts.threadId, firstThinking ? 'thinking-start' : 'thinking-token', {
        text: thinking,
      })
      firstThinking = false
    }
    if (content) {
      await publishThreadEvent(opts.threadId, 'token', { text: content })
    }
  }

  const toSec = (ms: number) => +(ms / 1000).toFixed(2)
  const genMs = firstTokenTime !== null ? Date.now() - firstTokenTime : 0
  logger.info(
    {
      ttftSec: firstTokenTime !== null ? toSec(firstTokenTime - startTime) : null,
      tps: genMs > 0 ? +(chunkCount / (genMs / 1000)).toFixed(1) : 0,
      chunks: chunkCount,
      totalSec: toSec(Date.now() - startTime),
      ...opts.metricsCtx,
    },
    '📈 stream metrics',
  )
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
}

/* ─────────────────────────────────────────────────────────────
 * Worker — handles chat-run jobs (interactive, detached) and
 * schedule-* jobs (scheduled tasks). Cancel flows in via the
 * thread:*:control Redis channel.
 * ───────────────────────────────────────────────────────────── */
export function startWorker(logger: Logger): Worker {
  if (worker) return worker

  // Control channel: { action: 'cancel', jobId } → abort the in-flight run
  controlSub = getConnection().duplicate()
  controlSub.on('error', (err) => logger.error({ err: err.message }, 'control subscriber error'))
  controlSub.on('pmessage', (pattern: string, channel: string, raw: string) => {
    try {
      const msg = JSON.parse(raw) as { action?: string; jobId?: string }
      if (msg.action === 'cancel' && msg.jobId) {
        const controller = activeRuns.get(msg.jobId)
        if (controller) {
          logger.info({ jobId: msg.jobId, channel }, '⏹ cancel received — aborting run')
          controller.abort()
        }
      }
    } catch {
      // malformed control message — ignore
    }
  })
  void controlSub.psubscribe('thread:*:control')

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { publishThreadEvent } = await import('./pubsub.js')

      /* ── Interactive chat run (detached; POST /messages enqueued it) ── */
      if (job.name === 'chat-run') {
        const { threadId, content, deepResearch } = job.data as {
          threadId: string
          content: string
          deepResearch?: boolean
        }
        logger.info(
          { jobId: job.id, threadId, deepResearch: deepResearch ?? 'auto' },
          '💬 chat run started',
        )

        const abortController = new AbortController()
        activeRuns.set(job.id ?? chatJobId(threadId), abortController)
        const wallClock = AbortSignal.timeout(CHAT_TIMEOUT_MS)
        const killSignal = AbortSignal.any([abortController.signal, wallClock])

        try {
          const agent = await getAgent()
          await publishThreadEvent(threadId, 'stream-start', {})
          await streamAgentEvents(
            agent,
            { threadId, content, deepResearch, signal: killSignal, metricsCtx: { threadId } },
            logger,
          )
          await publishThreadEvent(threadId, 'stream-done', {})
          await publishThreadEvent(threadId, 'thread-updated', {})
          logger.info({ jobId: job.id, threadId }, '💬 chat run complete')
        } catch (err) {
          if (isAbortError(err)) {
            const byUser = abortController.signal.aborted
            logger.info({ jobId: job.id, threadId, byUser }, '⏹ chat run aborted')
            // Rewind needs the agent — best-effort inside its own try
            try {
              const agent = await getAgent()
              await rewindTurn(agent, threadId, logger)
            } catch {
              logger.warn({ threadId }, 'rewind skipped — agent unavailable')
            }
            await publishThreadEvent(threadId, 'cancelled', {})
            await publishThreadEvent(threadId, 'thread-updated', {})
          } else {
            logger.error(
              { jobId: job.id, threadId, err: err instanceof Error ? err.message : String(err) },
              'chat run failed',
            )
            await publishThreadEvent(threadId, 'error', {
              message: 'Agent failed to respond. Please try again.',
            })
            await publishThreadEvent(threadId, 'stream-done', {})
          }
        } finally {
          activeRuns.delete(job.id ?? chatJobId(threadId))
        }
        return
      }

      /* ── Scheduled agent run ── */
      if (job.data?.scheduleId) {
        logger.info(
          { jobId: job.id, scheduleId: job.data.scheduleId },
          '⏰ scheduled run triggered',
        )

        const { query } = await import('./postgres.js')

        const agent = await getAgent()

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

        const threadId = schedule.thread_id as string
        const prompt = schedule.prompt as string

        logger.info(
          { threadId, type: schedule.type, prompt: prompt.slice(0, 80) },
          'running scheduled agent',
        )

        await publishThreadEvent(threadId, 'stream-start', {})
        await streamAgentEvents(
          agent,
          { threadId, content: prompt, metricsCtx: { scheduleId: job.data.scheduleId, threadId } },
          logger,
        )
        await publishThreadEvent(threadId, 'stream-done', {})

        // Update last_run
        await query('UPDATE schedules SET last_run = NOW() WHERE id = $1', [job.data.scheduleId])

        // One-time schedules auto-delete after firing
        if (schedule.type === 'once') {
          await query('DELETE FROM schedules WHERE id = $1', [job.data.scheduleId])
          logger.info({ scheduleId: job.data.scheduleId }, '⏰ one-time schedule fired + deleted')
        } else {
          logger.info({ scheduleId: job.data.scheduleId }, '⏰ scheduled run complete')
        }

        await publishThreadEvent(threadId, 'thread-updated', { scheduleId: job.data.scheduleId })
        return
      }

      // Default handler for other jobs
      logger.info({ jobId: job.id, name: job.name }, 'processing job')
    },
    { connection: getConnection(), concurrency: WORKER_CONCURRENCY },
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'job completed')
  })
  worker.on('failed', (job, err) => {
    // Abort failures are expected on cancel — log INFO, not ERROR
    if (isAbortError(err)) {
      logger.info({ jobId: job?.id, name: job?.name }, 'job aborted (cancel)')
      return
    }
    logger.error({ jobId: job?.id, name: job?.name, err: err.message }, 'job failed')
  })
  return worker
}

export async function closeWorker(): Promise<void> {
  await worker?.close()
  if (controlSub) {
    await controlSub.quit().catch(() => controlSub?.disconnect())
    controlSub = null
  }
}

export async function closeQueue(): Promise<void> {
  await closeWorker()
  await defaultQueue?.close()
  connection?.disconnect()
}
