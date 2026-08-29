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
import { extractChunk } from '../agent/extract.js'
import { buildAgent, messages as lcMessages } from '../agent/graph.js'
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

// Continue a thread — stream the assistant's reply as SSE token chunks
threads.post('/threads/:id/messages', async (c) => {
  const paramsParsed = paramsSchema.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const json = await c.req.json().catch(() => null)
  const parsed = sendMessageSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  await requireThread(paramsParsed.data.id)

  const agent = await getAgent()

  // Touch updated_at on the thread
  await query('UPDATE threads SET updated_at = NOW() WHERE id = $1', [paramsParsed.data.id])

  return streamSSE(c, async (stream) => {
    // Abort the agent stream if the client disconnects (navigates away,
    // closes tab, etc.) so we don't burn LLM tokens for nobody.
    const abortController = new AbortController()
    stream.onAbort(() => {
      abortController.abort()
      logger.info({ threadId: paramsParsed.data.id }, 'client disconnected — aborting agent stream')
    })

    // Emit the user's message back so the UI can echo it immediately
    await stream.writeSSE({
      event: 'user',
      data: JSON.stringify({ role: 'user', content: parsed.data.content }),
    })

    try {
      const streamEvents = await agent.stream(
        { messages: [new lcMessages.HumanMessage(parsed.data.content)] },
        {
          // deep_research flows per-request through configurable →
          // read by callModel (prompt directive) + dedupTools (hard block)
          configurable: {
            thread_id: paramsParsed.data.id,
            deep_research: parsed.data.deepResearch,
          },
          streamMode: 'messages',
          recursionLimit: 25,
          signal: abortController.signal,
        },
      )

      let firstThinking = true
      let firstToken = true

      // Stream metrics: TTFT + TPS (all durations logged in seconds)
      const startTime = Date.now()
      let firstTokenTime: number | null = null
      let chunkCount = 0

      for await (const [chunk] of streamEvents) {
        const type = chunk._getType()

        // Tool result message (after a tool executes)
        if (type === 'tool') {
          const toolName = (chunk as lcMessages.ToolMessage).name ?? 'tool'
          const raw = (chunk as lcMessages.ToolMessage).content
          const resultText = typeof raw === 'string' ? raw : JSON.stringify(raw)
          await stream.writeSSE({
            event: 'tool-result',
            data: JSON.stringify({ name: toolName, content: resultText.slice(0, 2000) }),
          })
          // Reset token flags so the next AI response starts fresh
          firstToken = true
          firstThinking = true
          continue
        }

        if (type !== 'ai') continue

        // Check for tool calls (LLM decided to call a tool)
        // Tool call args arrive in incremental chunks — accumulate them
        // and emit only when complete (when a new chunk has no name and
        // we already have a pending call, OR when the message type changes).
        const aiChunk = chunk as lcMessages.AIMessageChunk
        const toolCallChunks = aiChunk.tool_call_chunks ?? []
        for (const tc of toolCallChunks) {
          if (tc.name) {
            // New tool call starts — emit immediately with the name
            await stream.writeSSE({
              event: 'tool-call',
              data: JSON.stringify({ name: tc.name, args: tc.args ?? '' }),
            })
          }
          // Args fragments are intentionally NOT emitted separately —
          // the UI shows the tool name + "Fetching results…" which is
          // sufficient. Full args are available in the checkpoint.
        }

        const { thinking, content } = extractChunk(chunk)

        if (thinking || content) {
          if (firstTokenTime === null) firstTokenTime = Date.now()
          chunkCount++
        }

        if (thinking) {
          await stream.writeSSE({
            event: firstThinking ? 'thinking-start' : 'thinking-token',
            data: JSON.stringify({ text: thinking }),
          })
          firstThinking = false
        }

        if (content) {
          await stream.writeSSE({
            event: firstToken ? 'assistant-start' : 'token',
            data: JSON.stringify({ text: content }),
          })
          firstToken = false
        }
      }

      // Log stream metrics — all durations in seconds
      const toSec = (ms: number) => +(ms / 1000).toFixed(2)
      const totalMs = Date.now() - startTime
      const genMs = firstTokenTime !== null ? Date.now() - firstTokenTime : 0
      logger.info(
        {
          ttftSec: firstTokenTime !== null ? toSec(firstTokenTime - startTime) : null,
          tps: genMs > 0 ? +(chunkCount / (genMs / 1000)).toFixed(1) : 0,
          chunks: chunkCount,
          totalSec: toSec(totalMs),
          threadId: paramsParsed.data.id,
        },
        '📈 stream metrics',
      )

      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isRecursion = errMsg.includes('Recursion limit')
      logger.error(
        { err: errMsg, threadId: paramsParsed.data.id, recursion: isRecursion },
        'agent stream failed',
      )
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          message: isRecursion
            ? 'Agent hit the tool-call limit (25 steps). It may be stuck in a search loop. Try rephrasing your question.'
            : 'Agent failed to respond. Please try again.',
        }),
      })
    }
  })
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
