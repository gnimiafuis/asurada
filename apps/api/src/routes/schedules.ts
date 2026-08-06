import { randomUUID } from 'node:crypto'
import { createScheduleSchema, updateScheduleSchema } from '@asurada/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { query } from '../lib/postgres.js'
import { getQueue } from '../lib/queue.js'

type ScheduleRow = {
  id: string
  thread_id: string
  cron: string
  prompt: string
  enabled: boolean
  last_run: string | null
  created_at: string
}

const threadParams = z.object({ id: z.string().uuid() })
const scheduleParams = z.object({ id: z.string().uuid() })

function mapRow(row: ScheduleRow) {
  return {
    id: row.id,
    threadId: row.thread_id,
    cron: row.cron,
    prompt: row.prompt,
    enabled: row.enabled,
    lastRun: row.last_run ? new Date(row.last_run).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function requireThread(threadId: string) {
  const result = await query('SELECT id FROM threads WHERE id = $1', [threadId])
  if (result.rows.length === 0) throw new NotFoundError('Thread')
}

async function requireSchedule(scheduleId: string): Promise<ScheduleRow> {
  const result = await query<ScheduleRow>(
    'SELECT id, thread_id, cron, prompt, enabled, last_run, created_at FROM schedules WHERE id = $1',
    [scheduleId],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Schedule')
  return row
}

/** Register a BullMQ repeatable job for this schedule. */
async function registerJob(schedule: { id: string; cron: string; prompt: string }) {
  const queue = getQueue()
  await queue.add(
    `schedule-${schedule.id}`,
    { scheduleId: schedule.id, prompt: schedule.prompt },
    { repeat: { pattern: schedule.cron }, jobId: undefined },
  )
}

/** Remove the BullMQ repeatable job for this schedule. */
async function unregisterJob(scheduleId: string, cron: string) {
  const queue = getQueue()
  await queue.removeRepeatable(`schedule-${scheduleId}`, { pattern: cron })
}

export const schedules = new Hono()

// List schedules for a thread
schedules.get('/threads/:id/schedules', async (c) => {
  const parsed = threadParams.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  await requireThread(parsed.data.id)

  const result = await query<ScheduleRow>(
    'SELECT id, thread_id, cron, prompt, enabled, last_run, created_at FROM schedules WHERE thread_id = $1 ORDER BY created_at DESC',
    [parsed.data.id],
  )
  return c.json(result.rows.map(mapRow))
})

// Create schedule
schedules.post('/threads/:id/schedules', async (c) => {
  const paramsParsed = threadParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  await requireThread(paramsParsed.data.id)

  const json = await c.req.json().catch(() => null)
  const parsed = createScheduleSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const id = randomUUID()
  const result = await query<ScheduleRow>(
    `INSERT INTO schedules (id, thread_id, cron, prompt)
     VALUES ($1, $2, $3, $4)
     RETURNING id, thread_id, cron, prompt, enabled, last_run, created_at`,
    [id, paramsParsed.data.id, parsed.data.cron, parsed.data.prompt],
  )
  const created = result.rows[0]
  if (!created) throw new Error('INSERT did not return a row')

  // Register the BullMQ repeatable job
  await registerJob({ id: created.id, cron: created.cron, prompt: created.prompt })

  return c.json(mapRow(created), 201)
})

// Update schedule
schedules.patch('/schedules/:id', async (c) => {
  const paramsParsed = scheduleParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const existing = await requireSchedule(paramsParsed.data.id)

  const json = await c.req.json().catch(() => null)
  const parsed = updateScheduleSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const cron = parsed.data.cron ?? existing.cron
  const prompt = parsed.data.prompt ?? existing.prompt
  const enabled = parsed.data.enabled ?? existing.enabled

  const result = await query<ScheduleRow>(
    `UPDATE schedules SET cron = $1, prompt = $2, enabled = $3
     WHERE id = $4
     RETURNING id, thread_id, cron, prompt, enabled, last_run, created_at`,
    [cron, prompt, enabled, paramsParsed.data.id],
  )
  const updated = result.rows[0]
  if (!updated) throw new NotFoundError('Schedule')

  // Re-register the job if cron or prompt changed
  if (parsed.data.cron || parsed.data.prompt) {
    await unregisterJob(existing.id, existing.cron)
    if (enabled) {
      await registerJob({ id: updated.id, cron: updated.cron, prompt: updated.prompt })
    }
  }

  return c.json(mapRow(updated))
})

// Delete schedule
schedules.delete('/schedules/:id', async (c) => {
  const paramsParsed = scheduleParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const existing = await requireSchedule(paramsParsed.data.id)

  await query('DELETE FROM schedules WHERE id = $1', [paramsParsed.data.id])
  await unregisterJob(existing.id, existing.cron)

  return c.body(null, 204)
})
