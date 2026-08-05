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
import { messages as lcMessages } from '../agent/graph.js'
import { buildAgent } from '../agent/graph.js'
import { env } from '../env.js'
import { getCheckpointer, setupCheckpointer } from '../lib/checkpointer.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { query } from '../lib/postgres.js'

type Row = { id: string; title: string; created_at: string; updated_at: string }

const paramsSchema = z.object({ id: z.string().uuid() })

function mapRow(row: Row) {
  return {
    id: row.id,
    title: row.title,
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

/** Convert LangGraph BaseMessages into our plain { role, content } shape.
 * Uses `_getType()` instead of `instanceof` because messages deserialised
 * from the Postgres checkpoint may not be instances of the original class. */
function toPlainMessage(msg: lcMessages.BaseMessage): { role: string; content: string } {
  const type = msg._getType()
  let role = 'user'
  if (type === 'human') role = 'user'
  else if (type === 'ai') role = 'assistant'
  else if (type === 'system') role = 'system'
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
  return { role, content }
}

// Build the agent lazily so we don't construct it on every request.
let agentPromise: Promise<ReturnType<typeof buildAgent>> | null = null
function getAgent() {
  if (!agentPromise) {
    agentPromise = setupCheckpointer().then(() =>
      buildAgent(getCheckpointer(), env.AGENT_SYSTEM_PROMPT),
    )
  }
  return agentPromise
}

export const threads = new Hono()

// List threads
threads.get('/threads', async (c) => {
  const result = await query<Row>(
    'SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT 100',
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
    .filter((m) => m.content.length > 0)

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
  const threadConfig = { configurable: { thread_id: paramsParsed.data.id } }

  // Touch updated_at on the thread
  await query('UPDATE threads SET updated_at = NOW() WHERE id = $1', [paramsParsed.data.id])

  return streamSSE(c, async (stream) => {
    // Emit the user's message back so the UI can echo it immediately
    await stream.writeSSE({
      event: 'user',
      data: JSON.stringify({ role: 'user', content: parsed.data.content }),
    })

    try {
      const streamEvents = await agent.stream(
        { messages: [new lcMessages.HumanMessage(parsed.data.content)] },
        { ...threadConfig, streamMode: 'messages' },
      )

      let firstChunk = true
      for await (const [chunk] of streamEvents) {
        if (chunk._getType() !== 'ai') continue
        const text = typeof chunk.content === 'string' ? chunk.content : ''
        if (!text) continue
        await stream.writeSSE({
          event: firstChunk ? 'assistant-start' : 'token',
          data: JSON.stringify({ text }),
        })
        firstChunk = false
      }

      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), threadId: paramsParsed.data.id },
        'agent stream failed',
      )
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'Agent failed to respond' }),
      })
    }
  })
})

export type ThreadListResponse = z.infer<typeof threadSchema>[]
export type ThreadMessagesResponse = z.infer<typeof messageSchema>[]
