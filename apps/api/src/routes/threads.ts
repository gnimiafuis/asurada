import { randomUUID } from 'node:crypto'
import {
  createThreadSchema,
  type messageSchema,
  sendMessageSchema,
  type threadSchema,
  updateThreadSchema,
} from '@asurada/shared'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { buildAgent, type messages as lcMessages } from '../agent/graph.js'
import { env } from '../env.js'
import { getCheckpointer, setupCheckpointer } from '../lib/checkpointer.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { query } from '../lib/postgres.js'

type Row = {
  id: string
  title: string
  created_at: string
  updated_at: string
  schedule_count?: string
}

const paramsSchema = z.object({ id: z.string().uuid() })

function mapRow(row: Row) {
  return {
    id: row.id,
    title: row.title,
    scheduleCount: Number(row.schedule_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function requireThread(id: string) {
  const result = await query<Row>(
    'SELECT id, title, created_at, updated_at FROM threads WHERE id = $1',
    [id],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Thread')
  return mapRow(row)
}

/** Convert LangGraph BaseMessages into our plain { role, content, thinking } shape.
 * Uses `_getType()` instead of `instanceof` because messages deserialised
 * from the Postgres checkpoint may not be instances of the original class.
 * Tool messages are filtered out separately — they're internal state, not
 * something the UI should render as a chat message. */
function toPlainMessage(msg: lcMessages.BaseMessage): {
  role: string
  content: string
  thinking?: string
} | null {
  const type = msg._getType()

  // Skip tool messages — they're tool results, not chat messages.
  // The UI shows tool calls/results via the ToolCallsBlock, not as messages.
  if (type === 'tool') return null

  let role = 'user'
  if (type === 'human') role = 'user'
  else if (type === 'ai') role = 'assistant'
  else if (type === 'system') role = 'system'

  let content = ''
  let thinking: string | undefined

  // Content can be a string or an array of content blocks
  if (typeof msg.content === 'string') {
    content = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (typeof part === 'object' && part !== null && 'type' in part) {
        if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
          content += part.text
        } else if (
          part.type === 'reasoning' &&
          'reasoning' in part &&
          typeof part.reasoning === 'string'
        ) {
          thinking = (thinking ?? '') + part.reasoning
        }
      }
    }
  }

  // Reasoning from additional_kwargs (DeepSeek/MiniMax style)
  const reasoning = (msg.additional_kwargs as Record<string, unknown> | undefined)
    ?.reasoning_content
  if (typeof reasoning === 'string' && reasoning) {
    thinking = (thinking ?? '') + reasoning
  }

  // For AI messages with tool_calls but no text content, return a marker
  // so the caller can decide whether to include it. We return the object
  // with empty content and let the filter below handle it.
  return { role, content, thinking: thinking || undefined }
}

// Build the agent lazily so we don't construct it on every request.
let agentPromise: Promise<ReturnType<typeof buildAgent>> | null = null
function getAgent() {
  if (!agentPromise) {
    agentPromise = setupCheckpointer().then(() =>
      buildAgent(getCheckpointer(), {
        TAVILY_API_KEY: env.TAVILY_API_KEY,
        EXA_API_KEY: env.EXA_API_KEY,
        FIRECRAWL_API_KEY: env.FIRECRAWL_API_KEY,
      }),
    )
  }
  return agentPromise
}

export const threads = new Hono()

// List threads (includes enabled schedule count)
threads.get('/threads', async (c) => {
  const result = await query<Row>(
    `SELECT t.id, t.title, t.created_at, t.updated_at,
       (SELECT COUNT(*)::text FROM schedules s WHERE s.thread_id = t.id AND s.enabled = true) AS schedule_count
     FROM threads t
     ORDER BY t.updated_at DESC LIMIT 100`,
  )
  return c.json(result.rows.map(mapRow))
})

// Create thread
threads.post('/threads', async (c) => {
  const json = await c.req.json().catch(() => null)
  const parsed = createThreadSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const id = randomUUID()
  const title = parsed.data.title ?? 'New chat'
  const result = await query<Row>(
    'INSERT INTO threads (id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
    [id, title],
  )
  const created = result.rows[0]
  if (!created) throw new Error('INSERT did not return a row')
  return c.json(mapRow(created), 201)
})

// Get thread (metadata + full message history from LangGraph state)
threads.get('/threads/:id', async (c) => {
  const parsed = paramsSchema.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const thread = await requireThread(parsed.data.id)

  const agent = await getAgent()
  const state = await agent.getState({ configurable: { thread_id: parsed.data.id } })
  const rawMessages = (state.values?.messages ?? []) as lcMessages.BaseMessage[]
  const messageList = rawMessages
    .filter((m) => m._getType() !== 'system')
    .map(toPlainMessage)
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .filter((m) => m.content.length > 0 || m.thinking)

  return c.json({ ...thread, messages: messageList })
})

// Update thread title
threads.patch('/threads/:id', async (c) => {
  const paramsParsed = paramsSchema.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const json = await c.req.json().catch(() => null)
  const parsed = updateThreadSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const result = await query<Row>(
    'UPDATE threads SET title = $1 WHERE id = $2 RETURNING id, title, created_at, updated_at',
    [parsed.data.title, paramsParsed.data.id],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Thread')
  return c.json(mapRow(row))
})

// Delete thread (metadata + all LangGraph checkpoint state)
threads.delete('/threads/:id', async (c) => {
  const parsed = paramsSchema.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const result = await query('DELETE FROM threads WHERE id = $1 RETURNING id', [parsed.data.id])
  if (result.rows.length === 0) throw new NotFoundError('Thread')

  // Also purge LangGraph checkpoint state for this thread_id
  await query('DELETE FROM checkpoints WHERE thread_id = $1', [parsed.data.id])
  await query('DELETE FROM checkpoint_blobs WHERE thread_id = $1', [parsed.data.id])
  await query('DELETE FROM checkpoint_writes WHERE thread_id = $1', [parsed.data.id])

  return c.body(null, 204)
})

// Send a message — detached execution: enqueue a chat-run job, worker
// streams the response via Redis pub/sub → GET /threads/:id/events.
// Returns 202 immediately; 409 if a run is already active for the thread.
threads.post('/threads/:id/messages', async (c) => {
  const paramsParsed = paramsSchema.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const json = await c.req.json().catch(() => null)
  const parsed = sendMessageSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  await requireThread(paramsParsed.data.id)

  // One active run per thread — cancel it (Stop button) before sending again
  const { getQueue, hasActiveChatRun, chatJobId } = await import('../lib/queue.js')
  if (await hasActiveChatRun(paramsParsed.data.id)) {
    return c.json(
      {
        error: {
          code: 'RUN_IN_PROGRESS',
          message: 'A run is already in progress for this thread. Stop it first.',
        },
      },
      409,
    )
  }

  // Touch updated_at on the thread
  await query('UPDATE threads SET updated_at = NOW() WHERE id = $1', [paramsParsed.data.id])

  const jobId = chatJobId(paramsParsed.data.id)
  logger.info(
    { threadId: paramsParsed.data.id, jobId, deepResearch: parsed.data.deepResearch ?? 'auto' },
    '📨 message enqueued',
  )

  // attempts: 1 — never auto-retry a generation (would double-bill);
  // removeOnComplete — frees the jobId so the next send passes the guard
  await getQueue().add(
    'chat-run',
    {
      threadId: paramsParsed.data.id,
      content: parsed.data.content,
      deepResearch: parsed.data.deepResearch,
    },
    { jobId, attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  )

  return c.json({ jobId }, 202)
})

// Cancel the active run for a thread — worker aborts, rewinds the
// cancelled turn from the checkpoint, and publishes 'cancelled'.
threads.post('/threads/:id/cancel', async (c) => {
  const paramsParsed = paramsSchema.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  await requireThread(paramsParsed.data.id)

  const { hasActiveChatRun, chatJobId } = await import('../lib/queue.js')
  if (!(await hasActiveChatRun(paramsParsed.data.id))) {
    return c.json(
      { error: { code: 'NO_ACTIVE_RUN', message: 'No active run for this thread.' } },
      409,
    )
  }

  const jobId = chatJobId(paramsParsed.data.id)
  const { getPublisher } = await import('../lib/pubsub.js')
  const pub = getPublisher()
  if (!pub.isOpen) await pub.connect()
  await pub.publish(
    `thread:${paramsParsed.data.id}:control`,
    JSON.stringify({ action: 'cancel', jobId }),
  )
  logger.info({ threadId: paramsParsed.data.id, jobId }, '⏹ cancel requested')

  return c.json({ cancelled: true, jobId }, 202)
})

// SSE: real-time thread updates (scheduled task results, etc.)
threads.get('/threads/:id/events', async (c) => {
  const parsed = paramsSchema.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const { subscribeToThread } = await import('../lib/pubsub.js')

  return streamSSE(c, async (stream) => {
    let subscriber: Awaited<ReturnType<typeof subscribeToThread>> | null = null
    let keepAlive: ReturnType<typeof setInterval> | null = null

    try {
      subscriber = await subscribeToThread(parsed.data.id, (message) => {
        try {
          const msg = JSON.parse(message) as { event: string; data: unknown }
          void stream.writeSSE({ event: msg.event, data: JSON.stringify(msg.data) })
        } catch {
          void stream.writeSSE({ event: 'thread-updated', data: message })
        }
      })

      // Keep alive every 30s
      keepAlive = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {})
      }, 30_000)

      // BLOCK until client disconnects — without this the handler returns
      // immediately and Hono closes the stream, causing EventSource reconnect loop
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve())
      })
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'SSE subscription failed',
      )
    } finally {
      if (keepAlive) clearInterval(keepAlive)
      if (subscriber) {
        try {
          await subscriber.unsubscribe(`thread:${parsed.data.id}`)
          await subscriber.quit()
        } catch {
          // ignore cleanup errors
        }
      }
    }
  })
})

export type ThreadListResponse = z.infer<typeof threadSchema>[]
export type ThreadMessagesResponse = z.infer<typeof messageSchema>[]
